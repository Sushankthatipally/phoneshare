use std::{
    net::{IpAddr, SocketAddr},
    path::PathBuf,
};

use anyhow::{Context, Result};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{net::TcpListener, sync::broadcast};
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

use crate::{
    crypto::EncryptedChunk,
    mdns::{DiscoveredPeer, DiscoveryRuntime, DiscoveryService, DiscoveryStatus},
    transfer::{
        DeviceIdentity, FileManifest, PairingStartRequest, PairingStartResponse, PairingVerifyRequest, ProgressState,
        SessionSummary, TransferCoordinator, TransferSession,
    },
    usb_android::{UsbAndroidBridge, UsbAndroidStatus},
    usb_ios::{UsbIosBridge, UsbIosStatus},
};

#[derive(Debug, Clone)]
pub struct BackendConfig {
    pub bind_host: IpAddr,
    pub port: u16,
    pub static_root: PathBuf,
    pub download_root: PathBuf,
    pub local_device: DeviceIdentity,
    pub discovery_port: u16,
    pub adb_binary: String,
    pub android_device_port: u16,
    pub iproxy_binary: String,
    pub ios_device_port: u16,
}

#[derive(Debug, Clone)]
struct AppState {
    bind_host: IpAddr,
    port: u16,
    static_root: PathBuf,
    download_root: PathBuf,
    transfer: TransferCoordinator,
    discovery: DiscoveryService,
    android: UsbAndroidBridge,
    ios: UsbIosBridge,
    events: broadcast::Sender<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    bind_url: String,
    static_root: String,
    download_root: String,
    discovery: DiscoveryStatus,
    usb_android: UsbAndroidStatus,
    usb_ios: UsbIosStatus,
    session_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryResponse {
    status: DiscoveryStatus,
    peers: Vec<DiscoveredPeer>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutboundManifestRequest {
    paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkListResponse {
    file_id: String,
    chunks: Vec<EncryptedChunk>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FailureRequest {
    message: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Debug)]
struct ApiError(anyhow::Error);

type ApiResult<T> = std::result::Result<Json<T>, ApiError>;

impl<E> From<E> for ApiError
where
    E: Into<anyhow::Error>,
{
    fn from(value: E) -> Self {
        Self(value.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let message = self.0.to_string();
        let status = if message.contains("not found") {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::BAD_REQUEST
        };

        (status, Json(ErrorResponse { error: message })).into_response()
    }
}

pub async fn run_backend(config: BackendConfig) -> Result<()> {
    let transfer = TransferCoordinator::new(config.download_root.clone());
    let discovery = DiscoveryService::new(
        config.local_device.clone(),
        config.bind_host.to_string(),
        config.port,
        Some(config.discovery_port),
    );
    let discovery_runtime = discovery.spawn().await?;
    let android = UsbAndroidBridge::new(config.adb_binary.clone(), config.port, config.android_device_port);
    let ios = UsbIosBridge::new(config.iproxy_binary.clone(), config.port, config.ios_device_port);
    let (events, _) = broadcast::channel(256);

    let state = AppState {
        bind_host: config.bind_host,
        port: config.port,
        static_root: config.static_root.clone(),
        download_root: config.download_root.clone(),
        transfer,
        discovery,
        android,
        ios,
        events,
    };

    let app = build_router(state.clone(), &config);
    let bind_address = SocketAddr::new(config.bind_host, config.port);
    let listener = TcpListener::bind(bind_address)
        .await
        .with_context(|| format!("failed to bind DropBeam backend on {bind_address}"))?;
    tracing::info!("dropbeam backend listening on http://{bind_address}");

    let server = axum::serve(listener, app).with_graceful_shutdown(shutdown_signal());
    let result = server
        .await
        .context("DropBeam backend server terminated unexpectedly");

    shutdown_runtime(discovery_runtime, &state).await;
    result
}

fn build_router(state: AppState, config: &BackendConfig) -> Router {
    let mut router = Router::new()
        .route("/api/health", get(health))
        .route("/api/discovery", get(discovery))
        .route("/api/pairing/start", post(start_pairing))
        .route("/api/pairing/verify", post(verify_pairing))
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions/{session_id}", get(get_session))
        .route("/api/sessions/{session_id}/summary", get(session_summary))
        .route(
            "/api/sessions/{session_id}/manifest/outbound",
            post(stage_outbound_manifest),
        )
        .route(
            "/api/sessions/{session_id}/manifest/inbound",
            post(accept_inbound_manifest),
        )
        .route(
            "/api/sessions/{session_id}/files/{file_id}/chunks",
            get(read_chunks).post(receive_chunk),
        )
        .route("/api/sessions/{session_id}/fail", post(mark_failed))
        .route("/api/usb/android/status", get(android_status))
        .route("/api/usb/android/tunnel", post(enable_android_tunnel))
        .route("/api/usb/android/tunnel/clear", post(clear_android_tunnel))
        .route("/api/usb/ios/status", get(ios_status))
        .route("/api/usb/ios/tunnel", post(enable_ios_tunnel))
        .route("/api/usb/ios/tunnel/clear", post(clear_ios_tunnel))
        .route("/ws/events", get(events_socket))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    if config.static_root.exists() {
        let index_file = config.static_root.join("index.html");
        let static_service = ServeDir::new(config.static_root.clone()).not_found_service(ServeFile::new(index_file));
        router = router.fallback_service(static_service);
    }

    router.with_state(state)
}

async fn shutdown_runtime(discovery_runtime: DiscoveryRuntime, state: &AppState) {
    discovery_runtime.shutdown().await;
    if let Err(error) = state.ios.stop_forward_tunnel().await {
        tracing::warn!("failed to stop iOS tunnel cleanly: {error}");
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::warn!("failed to listen for ctrl+c: {error}");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::warn!("failed to listen for SIGTERM: {error}"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

async fn health(State(state): State<AppState>) -> ApiResult<HealthResponse> {
    let discovery = state.discovery.status().await;
    let usb_android = state.android.status().await;
    let usb_ios = state.ios.status().await;
    let session_count = state.transfer.list_sessions().await.len();

    Ok(Json(HealthResponse {
        ok: true,
        bind_url: format!("http://{}:{}/", state.bind_host, state.port),
        static_root: state.static_root.display().to_string(),
        download_root: state.download_root.display().to_string(),
        discovery,
        usb_android,
        usb_ios,
        session_count,
    }))
}

async fn discovery(State(state): State<AppState>) -> ApiResult<DiscoveryResponse> {
    Ok(Json(DiscoveryResponse {
        status: state.discovery.status().await,
        peers: state.discovery.list_peers().await,
    }))
}

async fn start_pairing(
    State(state): State<AppState>,
    Json(request): Json<PairingStartRequest>,
) -> ApiResult<PairingStartResponse> {
    let response = state.transfer.start_pairing(request).await?;
    emit_event(&state.events, "pairingStarted", &response);
    Ok(Json(response))
}

async fn verify_pairing(
    State(state): State<AppState>,
    Json(request): Json<PairingVerifyRequest>,
) -> ApiResult<TransferSession> {
    let session = state.transfer.verify_pairing(request).await?;
    emit_event(&state.events, "pairingVerified", &session);
    Ok(Json(session))
}

async fn list_sessions(State(state): State<AppState>) -> ApiResult<Vec<TransferSession>> {
    Ok(Json(state.transfer.list_sessions().await))
}

async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> ApiResult<TransferSession> {
    Ok(Json(state.transfer.get_session(&session_id).await?))
}

async fn session_summary(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> ApiResult<SessionSummary> {
    Ok(Json(state.transfer.session_summary(&session_id).await?))
}

async fn stage_outbound_manifest(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<OutboundManifestRequest>,
) -> ApiResult<FileManifest> {
    let paths = request.paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let manifest = state
        .transfer
        .stage_outbound_manifest(&session_id, paths)
        .await?;
    emit_event(&state.events, "outboundManifestStaged", &manifest);
    Ok(Json(manifest))
}

async fn accept_inbound_manifest(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(manifest): Json<FileManifest>,
) -> ApiResult<TransferSession> {
    let session = state
        .transfer
        .accept_inbound_manifest(&session_id, manifest)
        .await?;
    emit_event(&state.events, "inboundManifestAccepted", &session);
    Ok(Json(session))
}

async fn read_chunks(
    State(state): State<AppState>,
    Path((session_id, file_id)): Path<(String, String)>,
) -> ApiResult<ChunkListResponse> {
    let chunks = state
        .transfer
        .read_encrypted_chunks(&session_id, &file_id)
        .await?;
    Ok(Json(ChunkListResponse { file_id, chunks }))
}

async fn receive_chunk(
    State(state): State<AppState>,
    Path((session_id, file_id)): Path<(String, String)>,
    Json(chunk): Json<EncryptedChunk>,
) -> ApiResult<ProgressState> {
    let progress = state
        .transfer
        .receive_chunk(&session_id, &file_id, chunk)
        .await?;
    emit_event(
        &state.events,
        "chunkReceived",
        &json!({
            "sessionId": session_id,
            "fileId": file_id,
            "progress": progress,
        }),
    );
    Ok(Json(progress))
}

async fn mark_failed(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<FailureRequest>,
) -> ApiResult<TransferSession> {
    let session = state
        .transfer
        .mark_transfer_failed(&session_id, request.message)
        .await?;
    emit_event(&state.events, "transferFailed", &session);
    Ok(Json(session))
}

async fn android_status(State(state): State<AppState>) -> ApiResult<UsbAndroidStatus> {
    Ok(Json(state.android.status().await))
}

async fn enable_android_tunnel(State(state): State<AppState>) -> ApiResult<UsbAndroidStatus> {
    let status = state.android.ensure_reverse_tunnel().await?;
    emit_event(&state.events, "androidTunnelReady", &status);
    Ok(Json(status))
}

async fn clear_android_tunnel(State(state): State<AppState>) -> ApiResult<serde_json::Value> {
    state.android.remove_reverse_tunnel().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn ios_status(State(state): State<AppState>) -> ApiResult<UsbIosStatus> {
    Ok(Json(state.ios.status().await))
}

async fn enable_ios_tunnel(State(state): State<AppState>) -> ApiResult<UsbIosStatus> {
    let status = state.ios.ensure_forward_tunnel().await?;
    emit_event(&state.events, "iosTunnelReady", &status);
    Ok(Json(status))
}

async fn clear_ios_tunnel(State(state): State<AppState>) -> ApiResult<serde_json::Value> {
    state.ios.stop_forward_tunnel().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn events_socket(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_events_socket(socket, state.events.subscribe()))
}

async fn handle_events_socket(mut socket: WebSocket, mut receiver: broadcast::Receiver<String>) {
    while let Ok(message) = receiver.recv().await {
        if socket.send(Message::Text(message.into())).await.is_err() {
            break;
        }
    }
}

fn emit_event<T: Serialize>(events: &broadcast::Sender<String>, event: &str, payload: &T) {
    let message = match serde_json::to_string(&json!({ "event": event, "payload": payload })) {
        Ok(message) => message,
        Err(error) => {
            tracing::warn!("failed to serialize backend event {event}: {error}");
            return;
        }
    };

    let _ = events.send(message);
}

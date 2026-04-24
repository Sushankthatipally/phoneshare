use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{anyhow, bail, Context, Result};
use chrono::Utc;
use mime_guess::MimeGuess;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs::{self, File, OpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
    sync::RwLock,
};
use uuid::Uuid;

use crate::crypto::{
    build_pairing_payload, decrypt_chunk, derive_session_key, encrypt_chunk, export_public_key, generate_key_agreement,
    EncryptedChunk, KeyAgreement, PairingPayload, SessionKey,
};
use crate::pairing::{build_pairing_details, mark_pairing_verified};
use crate::qr::serialize_pairing_payload;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferMode {
    Usb,
    Wifi,
    Hotspot,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Desktop,
    Android,
    Iphone,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Idle,
    Discovering,
    Pairing,
    Paired,
    Transferring,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PairingState {
    Unpaired,
    QrScanned,
    PinRequired,
    Verified,
    Expired,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub id: String,
    pub kind: DeviceKind,
    pub name: String,
    pub platform: Option<String>,
    pub is_local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingDetails {
    pub state: PairingState,
    pub session_id: String,
    pub expires_at: String,
    pub pin: Option<String>,
    pub qr_payload: Option<String>,
    pub verified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPeer {
    pub device: DeviceIdentity,
    pub transport: TransferMode,
    pub address: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDescriptor {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub last_modified: Option<i64>,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionInfo {
    pub algorithm: String,
    pub key_id: Option<String>,
    pub nonce_encoding: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManifest {
    pub transfer_id: String,
    pub files: Vec<FileDescriptor>,
    pub total_bytes: u64,
    pub chunk_size: usize,
    pub encryption: EncryptionInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProgressState {
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub completed_files: usize,
    pub total_files: usize,
    pub percent: f64,
    pub speed_bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub file: FileDescriptor,
    pub status: String,
    pub progress: ProgressState,
    pub position: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    pub items: Vec<QueueItem>,
    pub active_item_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSession {
    pub id: String,
    pub mode: TransferMode,
    pub state: SessionState,
    pub local_device: DeviceIdentity,
    pub remote_device: Option<DeviceIdentity>,
    pub pairing: PairingDetails,
    pub peer: Option<SessionPeer>,
    pub created_at: String,
    pub updated_at: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub mode: TransferMode,
    pub state: SessionState,
    pub remote_name: Option<String>,
    pub total_files: usize,
    pub total_bytes: u64,
    pub completed_bytes: u64,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStartRequest {
    pub mode: TransferMode,
    pub local_device: DeviceIdentity,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStartResponse {
    pub session: TransferSession,
    pub payload: PairingPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingVerifyRequest {
    pub session_id: String,
    pub remote_device: DeviceIdentity,
    pub remote_public_key: String,
    pub pin: Option<String>,
    pub address: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug)]
struct TrackedSession {
    session: TransferSession,
    local_keys: KeyAgreement,
    session_key: Option<SessionKey>,
    manifest: Option<FileManifest>,
    queue: QueueState,
    outbound_paths: HashMap<String, PathBuf>,
    inbound_paths: HashMap<String, PathBuf>,
    next_chunk: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
pub struct TransferCoordinator {
    download_root: PathBuf,
    sessions: Arc<RwLock<HashMap<String, TrackedSession>>>,
}

impl TransferCoordinator {
    pub fn new(download_root: impl Into<PathBuf>) -> Self {
        Self {
            download_root: download_root.into(),
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start_pairing(&self, request: PairingStartRequest) -> Result<PairingStartResponse> {
        let created_at = timestamp();
        let key_agreement = generate_key_agreement();
        let payload = build_pairing_payload(
            request.host,
            request.port,
            transport_label(request.mode),
            export_public_key(&key_agreement.public_key),
            std::time::Duration::from_secs(600),
        );

        let session = TransferSession {
            id: payload.session_id.clone(),
            mode: request.mode,
            state: SessionState::Pairing,
            local_device: request.local_device,
            remote_device: None,
            pairing: build_pairing_details(
                payload.session_id.clone(),
                payload.expires_at.clone(),
                serialize_pairing_payload(&payload)?,
            ),
            peer: None,
            created_at: created_at.clone(),
            updated_at: created_at,
            last_error: None,
        };

        self.sessions.write().await.insert(
            payload.session_id.clone(),
            TrackedSession {
                session: session.clone(),
                local_keys: key_agreement,
                session_key: None,
                manifest: None,
                queue: QueueState::default(),
                outbound_paths: HashMap::new(),
                inbound_paths: HashMap::new(),
                next_chunk: HashMap::new(),
            },
        );

        Ok(PairingStartResponse { session, payload })
    }

    pub async fn verify_pairing(&self, request: PairingVerifyRequest) -> Result<TransferSession> {
        let mut sessions = self.sessions.write().await;
        let tracked = sessions
            .get_mut(&request.session_id)
            .with_context(|| format!("session {} does not exist", request.session_id))?;

        let session_key = derive_session_key(&tracked.local_keys, &request.remote_public_key, &request.session_id)?;
        tracked.session_key = Some(session_key);
        tracked.session.remote_device = Some(request.remote_device.clone());
        tracked.session.peer = Some(SessionPeer {
            device: request.remote_device,
            transport: tracked.session.mode,
            address: request.address,
            port: request.port,
        });
        tracked.session.state = SessionState::Paired;
        mark_pairing_verified(&mut tracked.session.pairing);
        tracked.session.updated_at = timestamp();

        Ok(tracked.session.clone())
    }

    pub async fn list_sessions(&self) -> Vec<TransferSession> {
        self.sessions
            .read()
            .await
            .values()
            .map(|session| session.session.clone())
            .collect()
    }

    pub async fn get_session(&self, session_id: &str) -> Result<TransferSession> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .map(|session| session.session.clone())
            .with_context(|| format!("session {session_id} not found"))
    }

    pub async fn session_summary(&self, session_id: &str) -> Result<SessionSummary> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .with_context(|| format!("session {session_id} not found"))?;
        let progress = aggregate_progress(&session.queue);

        Ok(SessionSummary {
            session_id: session.session.id.clone(),
            mode: session.session.mode,
            state: session.session.state,
            remote_name: session.session.remote_device.as_ref().map(|device| device.name.clone()),
            total_files: progress.total_files,
            total_bytes: progress.total_bytes,
            completed_bytes: progress.completed_bytes,
            started_at: session.session.created_at.clone(),
            ended_at: matches!(session.session.state, SessionState::Completed)
                .then(|| session.session.updated_at.clone()),
        })
    }

    pub async fn stage_outbound_manifest(&self, session_id: &str, paths: Vec<PathBuf>) -> Result<FileManifest> {
        let mut sessions = self.sessions.write().await;
        let tracked = sessions
            .get_mut(session_id)
            .with_context(|| format!("session {session_id} not found"))?;
        let session_key = tracked
            .session_key
            .clone()
            .ok_or_else(|| anyhow!("session must be paired before files can be staged"))?;
        let chunk_size = default_chunk_size(tracked.session.mode);
        let files = paths
            .iter()
            .map(|path| describe_local_file(path))
            .collect::<Result<Vec<_>>>()?;
        let total_bytes = files.iter().map(|file| file.size).sum();
        let queue_items = files
            .iter()
            .enumerate()
            .map(|(index, file)| QueueItem {
                id: file.id.clone(),
                file: file.clone(),
                status: "queued".to_string(),
                progress: ProgressState {
                    total_bytes: file.size,
                    total_files: files.len(),
                    ..ProgressState::default()
                },
                position: index + 1,
            })
            .collect::<Vec<_>>();

        tracked.queue = QueueState {
            active_item_id: files.first().map(|file| file.id.clone()),
            items: queue_items,
        };
        tracked.outbound_paths = files
            .iter()
            .zip(paths.into_iter())
            .map(|(file, path)| (file.id.clone(), path))
            .collect();

        let manifest = FileManifest {
            transfer_id: format!("transfer-{}", Uuid::new_v4().simple()),
            files,
            total_bytes,
            chunk_size,
            encryption: EncryptionInfo {
                algorithm: session_key.algorithm.to_string(),
                key_id: Some(session_key.key_id),
                nonce_encoding: "base64url".to_string(),
            },
        };

        tracked.manifest = Some(manifest.clone());
        tracked.session.state = SessionState::Transferring;
        tracked.session.updated_at = timestamp();

        Ok(manifest)
    }

    pub async fn accept_inbound_manifest(&self, session_id: &str, manifest: FileManifest) -> Result<TransferSession> {
        let session_dir = self.download_root.join(session_id);
        fs::create_dir_all(&session_dir).await?;
        let mut sessions = self.sessions.write().await;
        let tracked = sessions
            .get_mut(session_id)
            .with_context(|| format!("session {session_id} not found"))?;

        if tracked.session_key.is_none() {
            bail!("session must be paired before receiving transfers");
        }

        tracked.inbound_paths.clear();
        tracked.next_chunk.clear();
        let mut inbound_paths = HashMap::new();
        let mut next_chunk = HashMap::new();
        let queue_items = manifest
            .files
            .iter()
            .enumerate()
            .map(|(index, file)| {
                let target_path = session_dir.join(safe_file_name(&file.name));
                inbound_paths.insert(file.id.clone(), target_path);
                next_chunk.insert(file.id.clone(), 0);

                QueueItem {
                    id: file.id.clone(),
                    file: file.clone(),
                    status: "queued".to_string(),
                    progress: ProgressState {
                        total_bytes: file.size,
                        total_files: manifest.files.len(),
                        ..ProgressState::default()
                    },
                    position: index + 1,
                }
            })
            .collect::<Vec<_>>();
        tracked.inbound_paths = inbound_paths;
        tracked.next_chunk = next_chunk;
        tracked.queue.items = queue_items;
        tracked.queue.active_item_id = manifest.files.first().map(|file| file.id.clone());
        tracked.manifest = Some(manifest);
        tracked.session.state = SessionState::Transferring;
        tracked.session.updated_at = timestamp();

        Ok(tracked.session.clone())
    }

    pub async fn read_encrypted_chunks(&self, session_id: &str, file_id: &str) -> Result<Vec<EncryptedChunk>> {
        let sessions = self.sessions.read().await;
        let tracked = sessions
            .get(session_id)
            .with_context(|| format!("session {session_id} not found"))?;
        let session_key = tracked
            .session_key
            .clone()
            .ok_or_else(|| anyhow!("session must be paired before reading chunks"))?;
        let manifest = tracked
            .manifest
            .clone()
            .ok_or_else(|| anyhow!("no manifest has been staged for this session"))?;
        let path = tracked
            .outbound_paths
            .get(file_id)
            .with_context(|| format!("file {file_id} has not been staged"))?;

        let mut file = File::open(path)
            .await
            .with_context(|| format!("failed to open outbound file {}", path.display()))?;
        let mut buffer = vec![0_u8; manifest.chunk_size];
        let mut index = 0_u64;
        let mut chunks = Vec::new();

        loop {
            let read = file
                .read(&mut buffer)
                .await
                .with_context(|| format!("failed to read {}", path.display()))?;

            if read == 0 {
                break;
            }

            let encrypted = encrypt_chunk(
                &session_key,
                session_id,
                file_id,
                index,
                &buffer[..read],
            )?;
            chunks.push(encrypted);
            index += 1;
        }

        Ok(chunks)
    }

    pub async fn receive_chunk(
        &self,
        session_id: &str,
        file_id: &str,
        chunk: EncryptedChunk,
    ) -> Result<ProgressState> {
        let mut sessions = self.sessions.write().await;
        let tracked = sessions
            .get_mut(session_id)
            .with_context(|| format!("session {session_id} not found"))?;
        let session_key = tracked
            .session_key
            .clone()
            .ok_or_else(|| anyhow!("session must be paired before receiving chunks"))?;
        let expected_index = tracked
            .next_chunk
            .get(file_id)
            .copied()
            .with_context(|| format!("file {file_id} is not part of the active inbound transfer"))?;

        if chunk.chunk_index != expected_index {
            bail!(
                "received chunk {} but expected {} for {}",
                chunk.chunk_index,
                expected_index,
                file_id
            );
        }

        let plaintext = decrypt_chunk(&session_key, session_id, file_id, &chunk)?;
        let target_path = tracked
            .inbound_paths
            .get(file_id)
            .with_context(|| format!("file {file_id} has no target path"))?
            .clone();
        let parent = target_path
            .parent()
            .ok_or_else(|| anyhow!("invalid inbound target path"))?;
        fs::create_dir_all(parent).await?;
        let mut output = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target_path)
            .await
            .with_context(|| format!("failed to open inbound file {}", target_path.display()))?;
        output
            .write_all(&plaintext)
            .await
            .with_context(|| format!("failed to write inbound file {}", target_path.display()))?;
        output.flush().await?;

        tracked.next_chunk.insert(file_id.to_string(), expected_index + 1);
        let total_files = tracked.queue.items.len();
        if let Some(queue_item) = tracked.queue.items.iter_mut().find(|item| item.id == file_id) {
            queue_item.status = "sending".to_string();
            queue_item.progress.completed_bytes =
                (queue_item.progress.completed_bytes + plaintext.len() as u64).min(queue_item.file.size);
            queue_item.progress.total_bytes = queue_item.file.size;
            queue_item.progress.total_files = total_files;
            queue_item.progress.percent = if queue_item.file.size == 0 {
                100.0
            } else {
                (queue_item.progress.completed_bytes as f64 / queue_item.file.size as f64) * 100.0
            };

            if queue_item.progress.completed_bytes >= queue_item.file.size {
                queue_item.status = "done".to_string();
            }
        }

        let completed_files = tracked
            .queue
            .items
            .iter()
            .filter(|item| item.progress.completed_bytes >= item.file.size)
            .count();
        if let Some(queue_item) = tracked.queue.items.iter_mut().find(|item| item.id == file_id) {
            queue_item.progress.completed_files = completed_files;
        }

        let aggregate = aggregate_progress(&tracked.queue);
        if aggregate.completed_files == aggregate.total_files && aggregate.total_files > 0 {
            tracked.session.state = SessionState::Completed;
        }
        tracked.session.updated_at = timestamp();

        Ok(aggregate)
    }

    pub async fn mark_transfer_failed(&self, session_id: &str, message: impl Into<String>) -> Result<TransferSession> {
        let mut sessions = self.sessions.write().await;
        let tracked = sessions
            .get_mut(session_id)
            .with_context(|| format!("session {session_id} not found"))?;

        tracked.session.state = SessionState::Failed;
        tracked.session.last_error = Some(message.into());
        tracked.session.updated_at = timestamp();

        Ok(tracked.session.clone())
    }
}

pub fn default_chunk_size(mode: TransferMode) -> usize {
    match mode {
        TransferMode::Usb => 4 * 1024 * 1024,
        TransferMode::Wifi => 1024 * 1024,
        TransferMode::Hotspot => 256 * 1024,
    }
}

fn describe_local_file(path: &Path) -> Result<FileDescriptor> {
    let metadata = std::fs::metadata(path)
        .with_context(|| format!("failed to stat file {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("file {} is missing a valid UTF-8 name", path.display()))?
        .to_string();
    let mime_type = MimeGuess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    Ok(FileDescriptor {
        id: format!("file-{}", Uuid::new_v4().simple()),
        name: file_name,
        size: metadata.len(),
        mime_type,
        last_modified: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64),
        checksum: Some(sha256_file(path)?),
    })
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)
        .with_context(|| format!("failed to open {} for checksum", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = std::io::Read::read(&mut file, &mut buffer)
            .with_context(|| format!("failed to read {} for checksum", path.display()))?;
        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

fn safe_file_name(name: &str) -> String {
    let candidate = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("incoming.bin")
        .trim();

    if candidate.is_empty() {
        "incoming.bin".to_string()
    } else {
        candidate.to_string()
    }
}

fn aggregate_progress(queue: &QueueState) -> ProgressState {
    let total_bytes = queue.items.iter().map(|item| item.file.size).sum::<u64>();
    let completed_bytes = queue
        .items
        .iter()
        .map(|item| item.progress.completed_bytes)
        .sum::<u64>();
    let completed_files = queue
        .items
        .iter()
        .filter(|item| item.progress.completed_bytes >= item.file.size)
        .count();

    ProgressState {
        completed_bytes,
        total_bytes,
        completed_files,
        total_files: queue.items.len(),
        percent: if total_bytes == 0 {
            0.0
        } else {
            (completed_bytes as f64 / total_bytes as f64) * 100.0
        },
        speed_bytes_per_second: 0,
        eta_seconds: None,
    }
}

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

fn transport_label(mode: TransferMode) -> &'static str {
    match mode {
        TransferMode::Usb => "usb",
        TransferMode::Wifi => "wifi",
        TransferMode::Hotspot => "hotspot",
    }
}

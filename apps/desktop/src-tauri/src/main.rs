// On release builds, run as a true Windows GUI app so no console window appears.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notify_shell;
mod shell_integration;
mod usb_android;
mod usb_ios;
mod watcher;

use std::{
    env,
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// Files passed in via `dropbeam-desktop.exe --send <path> [--send <path>]...`
/// (the Windows context-menu invocation). Held in app state so the JS layer
/// can pull them with `get_pending_send_paths`.
#[derive(Default)]
struct PendingSend(Mutex<Vec<String>>);

/// Handle to the sidecar Node backend process so we can kill it on exit.
struct BackendChild(Mutex<Option<CommandChild>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PendingSendPayload {
    paths: Vec<String>,
}

#[tauri::command]
fn get_pending_send_paths(state: State<'_, PendingSend>) -> Vec<String> {
    let mut guard = state.0.lock().expect("PendingSend lock poisoned");
    std::mem::take(&mut *guard)
}

#[tauri::command]
fn clear_pending_send_paths(state: State<'_, PendingSend>) {
    if let Ok(mut guard) = state.0.lock() {
        guard.clear();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickFolderResult {
    path: Option<String>,
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> PickFolderResult {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog().file().pick_folder(move |selected| {
        let path = selected.and_then(|p| p.into_path().ok().map(|pb| pb.to_string_lossy().into_owned()));
        let _ = tx.send(path);
    });
    let path = rx.await.ok().flatten();
    PickFolderResult { path }
}

fn main() {
    install_tracing();

    let send_paths = parse_send_paths(env::args().collect());

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(watcher::WatcherState::new())
        .manage(PendingSend(Mutex::new(send_paths.clone())))
        .manage(BackendChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            watcher::start_watch_folder,
            watcher::stop_watch_folder,
            watcher::list_files_in_folder,
            notify_shell::system_notify,
            shell_integration::register_context_menu,
            shell_integration::unregister_context_menu,
            usb_android::usb_android_status,
            usb_android::usb_android_ensure_tunnel,
            usb_android::usb_android_stop_tunnel,
            usb_ios::usb_ios_status,
            usb_ios::usb_ios_ensure_tunnel,
            usb_ios::usb_ios_stop_tunnel,
            get_pending_send_paths,
            clear_pending_send_paths,
            pick_folder,
        ])
        .setup(move |app| {
            spawn_backend_sidecar(app)?;

            // Notify the frontend about any files passed via context menu.
            if !send_paths.is_empty() {
                let app_handle: AppHandle = app.handle().clone();
                let paths = send_paths.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(750)).await;
                    let _ = app_handle.emit("dropbeam:send", PendingSendPayload { paths });
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                kill_backend(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run DropBeam desktop");
}

fn spawn_backend_sidecar(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();
    let data_dir = resolve_data_dir(app_handle);
    let download_dir = data_dir.join("downloads");
    std::fs::create_dir_all(&data_dir).ok();
    std::fs::create_dir_all(&download_dir).ok();

    let sidecar = app_handle
        .shell()
        .sidecar("dropbeam-backend")?
        .env("DROPBEAM_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env(
            "DROPBEAM_DOWNLOAD_ROOT",
            download_dir.to_string_lossy().to_string(),
        )
        // Bind to all interfaces so phones on the same Wi-Fi can hit the LAN IP.
        // The backend still validates guest tokens / pairing tickets, so this is safe.
        .env("DROPBEAM_BACKEND_HOST", "0.0.0.0")
        .env("DROPBEAM_BACKEND_PORT", "17619");

    let (mut rx, child) = sidecar.spawn()?;

    if let Some(state) = app_handle.try_state::<BackendChild>() {
        *state.0.lock().expect("BackendChild lock poisoned") = Some(child);
    }

    // Forward sidecar stdout / stderr into the host log.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    tracing::info!(target: "sidecar", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    tracing::warn!(target: "sidecar", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    tracing::warn!("sidecar terminated: {:?}", payload);
                }
                CommandEvent::Error(message) => {
                    tracing::warn!("sidecar error: {message}");
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn kill_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackendChild>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|p| p.join("backend"))
        .unwrap_or_else(|_| PathBuf::from("./dropbeam-data"))
}

fn parse_send_paths(args: Vec<String>) -> Vec<String> {
    let mut paths = Vec::new();
    let mut iter = args.into_iter().skip(1).peekable();
    while let Some(arg) = iter.next() {
        if arg == "--send" {
            if let Some(value) = iter.next() {
                paths.push(value);
            }
        } else if let Some(stripped) = arg.strip_prefix("--send=") {
            paths.push(stripped.to_string());
        }
    }
    paths
}

fn install_tracing() {
    let filter = env::var("DROPBEAM_LOG").unwrap_or_else(|_| "info,tower_http=info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}

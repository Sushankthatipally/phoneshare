// Tauri command: watch a folder for new files and notify the JS layer
// whenever something appears. Used by the "Watch Folders" feature so the
// desktop can auto-send anything dropped into a configured directory.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::Result;
use notify::{event::CreateKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    pub watch_id: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_fingerprint: Option<String>,
}

pub struct WatcherState {
    inner: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn start_watch_folder(
    app: AppHandle,
    state: State<'_, WatcherState>,
    id: Option<String>,
    path: String,
    destination_fingerprint: Option<String>,
) -> Result<String, String> {
    let watch_id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let id_for_event = watch_id.clone();
    let dest_for_event = destination_fingerprint.clone();
    let target = PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("folder does not exist: {path}"));
    }

    {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "watcher state lock poisoned".to_string())?;
        if guard.contains_key(&watch_id) {
            // Idempotent: caller can re-issue start with the same id without leaking watchers.
            return Ok(watch_id);
        }
    }

    let mut watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
        if let Ok(event) = result {
            // We only react to creates so we don't fire on metadata changes.
            let interesting = matches!(
                event.kind,
                EventKind::Create(CreateKind::File) | EventKind::Create(CreateKind::Any)
            );

            if !interesting {
                return;
            }

            // Deduplicate paths so we don't emit twice per atomic rename.
            let mut seen = HashSet::new();
            for path in event.paths.iter() {
                if !seen.insert(path.clone()) {
                    continue;
                }

                let payload = WatchEvent {
                    watch_id: id_for_event.clone(),
                    path: path.to_string_lossy().into_owned(),
                    kind: "created".into(),
                    destination_fingerprint: dest_for_event.clone(),
                };

                let _ = app.emit("dropbeam:watch", payload);
            }
        }
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&target, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    state
        .inner
        .lock()
        .map_err(|_| "watcher state lock poisoned".to_string())?
        .insert(watch_id.clone(), watcher);

    tracing::info!("watching folder {target:?} as watch_id={watch_id}");
    Ok(watch_id)
}

#[tauri::command]
pub async fn stop_watch_folder(
    state: State<'_, WatcherState>,
    id: String,
) -> Result<(), String> {
    let removed = state
        .inner
        .lock()
        .map_err(|_| "watcher state lock poisoned".to_string())?
        .remove(&id);

    if removed.is_none() {
        // Idempotent: stopping an unknown id is not an error.
        return Ok(());
    }
    tracing::info!("stopped watch_id={id}");
    Ok(())
}

#[tauri::command]
pub async fn list_files_in_folder(path: String) -> Result<Vec<String>, String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let mut read = tokio::fs::read_dir(target)
        .await
        .map_err(|error| error.to_string())?;
    while let Some(entry) = read
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        let p = entry.path();
        if p.is_file() {
            entries.push(p.to_string_lossy().into_owned());
        }
    }
    Ok(entries)
}

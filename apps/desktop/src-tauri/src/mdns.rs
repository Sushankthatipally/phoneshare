// Lightweight mDNS state surface used by the Diagnostics panel.
// W6 will replace the inner implementation with the real `mdns-sd` browse/publish
// pair; until then the desktop exposes a structured "not-yet-started" record so
// the UI can render an honest state instead of fabricating a value.

use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdnsPeer {
    pub service: String,
    pub host: String,
    pub port: u16,
    pub txt: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdnsState {
    pub running: bool,
    pub published_service: Option<String>,
    pub published_port: Option<u16>,
    pub last_error: Option<String>,
    pub peers: Vec<MdnsPeer>,
}

impl MdnsState {
    pub fn idle() -> Self {
        Self {
            running: false,
            published_service: None,
            published_port: None,
            last_error: None,
            peers: Vec::new(),
        }
    }
}

pub struct MdnsRegistry(Mutex<MdnsState>);

impl MdnsRegistry {
    pub fn new() -> Self {
        Self(Mutex::new(MdnsState::idle()))
    }

    pub fn snapshot(&self) -> MdnsState {
        self.0.lock().expect("MdnsRegistry lock poisoned").clone()
    }
}

#[tauri::command]
pub fn mdns_status(state: tauri::State<'_, MdnsRegistry>) -> MdnsState {
    state.snapshot()
}

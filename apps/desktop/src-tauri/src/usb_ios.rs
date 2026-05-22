// iOS USB transport is intentionally a stub in this build. The host-side
// iproxy (usbmuxd) plumbing is documented in the rebuild plan but not wired:
// every call returns `state: "unsupported"` so the UI can render a single,
// honest hint ("Connect over Wi-Fi instead") without dead spinners.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosStatus {
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosTunnelResult {
    pub ok: bool,
    pub state: String,
}

#[tauri::command]
pub async fn usb_ios_status() -> IosStatus {
    IosStatus {
        state: "unsupported".to_string(),
    }
}

#[tauri::command]
pub async fn usb_ios_ensure_tunnel() -> IosTunnelResult {
    IosTunnelResult {
        ok: false,
        state: "unsupported".to_string(),
    }
}

#[tauri::command]
pub async fn usb_ios_stop_tunnel() -> IosTunnelResult {
    IosTunnelResult {
        ok: false,
        state: "unsupported".to_string(),
    }
}

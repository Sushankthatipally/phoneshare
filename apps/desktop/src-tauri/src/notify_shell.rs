// Tauri command bridging JS to native OS notification banners.
// Shell-context-menu registration moved to `shell_integration.rs`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNotifyInput {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNotifyResult {
    pub ok: bool,
}

#[tauri::command]
pub fn system_notify(
    app: AppHandle,
    input: SystemNotifyInput,
) -> Result<SystemNotifyResult, String> {
    app.notification()
        .builder()
        .title(&input.title)
        .body(&input.body)
        .show()
        .map_err(|error| error.to_string())?;
    Ok(SystemNotifyResult { ok: true })
}

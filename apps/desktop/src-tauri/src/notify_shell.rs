// Tauri commands for system tray / OS notifications and (on Windows) the
// shell-context-menu registration for "Send via DropBeam → <device>".

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
pub fn system_notify(app: AppHandle, input: SystemNotifyInput) -> Result<SystemNotifyResult, String> {
    app.notification()
        .builder()
        .title(&input.title)
        .body(&input.body)
        .show()
        .map_err(|error| error.to_string())?;
    Ok(SystemNotifyResult { ok: true })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuInput {
    pub exe_path: String,
}

#[cfg(windows)]
#[tauri::command]
pub fn register_context_menu(input: ContextMenuInput) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // HKCU\Software\Classes\* gives the menu item to every file type.
    let (menu_key, _) = hkcu
        .create_subkey(r"Software\Classes\*\shell\DropBeam")
        .map_err(|e| e.to_string())?;
    menu_key
        .set_value("", &"Send via DropBeam")
        .map_err(|e| e.to_string())?;
    menu_key
        .set_value("Icon", &format!("\"{}\",0", input.exe_path))
        .map_err(|e| e.to_string())?;

    let (cmd_key, _) = hkcu
        .create_subkey(r"Software\Classes\*\shell\DropBeam\command")
        .map_err(|e| e.to_string())?;
    let command_value = format!("\"{}\" --send \"%1\"", input.exe_path);
    cmd_key
        .set_value("", &command_value)
        .map_err(|e| e.to_string())?;

    tracing::info!("registered Windows context menu for {}", input.exe_path);
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
pub fn unregister_context_menu() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(r"Software\Classes\*\shell\DropBeam");
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn register_context_menu(_input: ContextMenuInput) -> Result<(), String> {
    Err("Shell context menu is only supported on Windows for now".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn unregister_context_menu() -> Result<(), String> {
    Err("Shell context menu is only supported on Windows for now".into())
}

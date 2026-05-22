// Cross-platform "Send via DropBeam" shell integration. Settings toggles this
// on/off; each platform takes a different code path:
//   - Windows: HKCU\Software\Classes\*\shell\DropBeam\command
//   - macOS:   ~/Library/Services/Send via DropBeam.workflow (skeleton)
//   - Linux:   ~/.local/share/applications/dropbeam.desktop + mimeapps.list

use std::env;
use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationResult {
    pub ok: bool,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn current_exe_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = env::current_exe() {
        return Ok(path);
    }
    app.path()
        .resource_dir()
        .map(|p| p.join("dropbeam-desktop"))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn register_impl(app: &tauri::AppHandle) -> ShellIntegrationResult {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe_path = match current_exe_path(app) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "windows".to_string(),
                path: None,
                error: Some(e),
            }
        }
    };

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let menu_key = match hkcu.create_subkey(r"Software\Classes\*\shell\DropBeam") {
        Ok((k, _)) => k,
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "windows".to_string(),
                path: None,
                error: Some(e.to_string()),
            }
        }
    };
    if let Err(e) = menu_key.set_value("", &"Send via DropBeam") {
        return ShellIntegrationResult {
            ok: false,
            platform: "windows".to_string(),
            path: None,
            error: Some(e.to_string()),
        };
    }
    let _ = menu_key.set_value("Icon", &format!("\"{}\",0", exe_path));

    let cmd_key = match hkcu.create_subkey(r"Software\Classes\*\shell\DropBeam\command") {
        Ok((k, _)) => k,
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "windows".to_string(),
                path: None,
                error: Some(e.to_string()),
            }
        }
    };
    let command_value = format!("\"{}\" --send \"%1\"", exe_path);
    if let Err(e) = cmd_key.set_value("", &command_value) {
        return ShellIntegrationResult {
            ok: false,
            platform: "windows".to_string(),
            path: None,
            error: Some(e.to_string()),
        };
    }

    ShellIntegrationResult {
        ok: true,
        platform: "windows".to_string(),
        path: Some(r"HKCU\Software\Classes\*\shell\DropBeam".to_string()),
        error: None,
    }
}

#[cfg(target_os = "windows")]
fn unregister_impl(_app: &tauri::AppHandle) -> ShellIntegrationResult {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(r"Software\Classes\*\shell\DropBeam");
    ShellIntegrationResult {
        ok: true,
        platform: "windows".to_string(),
        path: None,
        error: None,
    }
}

#[cfg(target_os = "macos")]
fn macos_services_dir() -> Result<PathBuf, String> {
    let home = env::var("HOME").map_err(|e| e.to_string())?;
    Ok(PathBuf::from(home).join("Library").join("Services"))
}

#[cfg(target_os = "macos")]
fn register_impl(app: &tauri::AppHandle) -> ShellIntegrationResult {
    let exe_path = match current_exe_path(app) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "macos".to_string(),
                path: None,
                error: Some(e),
            }
        }
    };

    let services_dir = match macos_services_dir() {
        Ok(p) => p,
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "macos".to_string(),
                path: None,
                error: Some(e),
            }
        }
    };

    let workflow_dir = services_dir.join("Send via DropBeam.workflow");
    let contents_dir = workflow_dir.join("Contents");
    if let Err(e) = std::fs::create_dir_all(&contents_dir) {
        return ShellIntegrationResult {
            ok: false,
            platform: "macos".to_string(),
            path: None,
            error: Some(e.to_string()),
        };
    }

    let info_plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>Send via DropBeam</string>
      </dict>
      <key>NSMessage</key>
      <string>runWorkflowAsService</string>
      <key>NSSendFileTypes</key>
      <array>
        <string>public.item</string>
      </array>
      <key>NSRequiredContext</key>
      <dict>
        <key>NSApplicationIdentifier</key>
        <string>com.apple.finder</string>
      </dict>
    </dict>
  </array>
  <key>DropBeamBinary</key>
  <string>{}</string>
</dict>
</plist>
"#,
        exe_path
    );

    if let Err(e) = std::fs::write(contents_dir.join("Info.plist"), info_plist) {
        return ShellIntegrationResult {
            ok: false,
            platform: "macos".to_string(),
            path: None,
            error: Some(e.to_string()),
        };
    }

    // Workflow document body — Automator expects a `document.wflow` file. The
    // file we write is a minimal skeleton; full Automator action generation is
    // a stretch goal noted in the rebuild plan.
    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict><key>DropBeamBinary</key><string>{}</string></dict></plist>\n",
        exe_path
    );
    let _ = std::fs::write(contents_dir.join("document.wflow"), document);

    ShellIntegrationResult {
        ok: true,
        platform: "macos".to_string(),
        path: Some(workflow_dir.to_string_lossy().into_owned()),
        error: None,
    }
}

#[cfg(target_os = "macos")]
fn unregister_impl(_app: &tauri::AppHandle) -> ShellIntegrationResult {
    let services_dir = match macos_services_dir() {
        Ok(p) => p,
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "macos".to_string(),
                path: None,
                error: Some(e),
            }
        }
    };

    let workflow_dir = services_dir.join("Send via DropBeam.workflow");
    if workflow_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&workflow_dir) {
            return ShellIntegrationResult {
                ok: false,
                platform: "macos".to_string(),
                path: Some(workflow_dir.to_string_lossy().into_owned()),
                error: Some(e.to_string()),
            };
        }
    }

    ShellIntegrationResult {
        ok: true,
        platform: "macos".to_string(),
        path: None,
        error: None,
    }
}

#[cfg(target_os = "linux")]
fn linux_apps_dir() -> Result<PathBuf, String> {
    let home = env::var("HOME").map_err(|e| e.to_string())?;
    Ok(PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("applications"))
}

#[cfg(target_os = "linux")]
fn register_impl(app: &tauri::AppHandle) -> ShellIntegrationResult {
    let exe_path = match current_exe_path(app) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "linux".to_string(),
                path: None,
                error: Some(e),
            }
        }
    };

    let apps_dir = match linux_apps_dir() {
        Ok(p) => p,
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "linux".to_string(),
                path: None,
                error: Some(e),
            }
        }
    };
    if let Err(e) = std::fs::create_dir_all(&apps_dir) {
        return ShellIntegrationResult {
            ok: false,
            platform: "linux".to_string(),
            path: None,
            error: Some(e.to_string()),
        };
    }

    let desktop_path = apps_dir.join("dropbeam.desktop");
    let desktop_entry = format!(
        "[Desktop Entry]\nVersion=1.0\nType=Application\nName=DropBeam\nGenericName=Send via DropBeam\nExec=\"{}\" --send %f\nIcon=dropbeam\nTerminal=false\nMimeType=application/octet-stream;\nCategories=Network;FileTransfer;\n",
        exe_path
    );
    if let Err(e) = std::fs::write(&desktop_path, desktop_entry) {
        return ShellIntegrationResult {
            ok: false,
            platform: "linux".to_string(),
            path: Some(desktop_path.to_string_lossy().into_owned()),
            error: Some(e.to_string()),
        };
    }

    // Append (idempotent) to mimeapps.list so xdg-open routes through us.
    let mimeapps = apps_dir.join("mimeapps.list");
    let existing = std::fs::read_to_string(&mimeapps).unwrap_or_default();
    if !existing.contains("dropbeam.desktop") {
        let block = if existing.contains("[Default Applications]") {
            existing.replace(
                "[Default Applications]",
                "[Default Applications]\napplication/octet-stream=dropbeam.desktop;",
            )
        } else {
            format!(
                "{existing}\n[Default Applications]\napplication/octet-stream=dropbeam.desktop;\n"
            )
        };
        let _ = std::fs::write(&mimeapps, block);
    }

    ShellIntegrationResult {
        ok: true,
        platform: "linux".to_string(),
        path: Some(desktop_path.to_string_lossy().into_owned()),
        error: None,
    }
}

#[cfg(target_os = "linux")]
fn unregister_impl(_app: &tauri::AppHandle) -> ShellIntegrationResult {
    let apps_dir = match linux_apps_dir() {
        Ok(p) => p,
        Err(e) => {
            return ShellIntegrationResult {
                ok: false,
                platform: "linux".to_string(),
                path: None,
                error: Some(e),
            }
        }
    };

    let desktop_path = apps_dir.join("dropbeam.desktop");
    if desktop_path.exists() {
        let _ = std::fs::remove_file(&desktop_path);
    }

    let mimeapps = apps_dir.join("mimeapps.list");
    if let Ok(existing) = std::fs::read_to_string(&mimeapps) {
        let cleaned: String = existing
            .lines()
            .filter(|line| !line.contains("dropbeam.desktop"))
            .collect::<Vec<_>>()
            .join("\n");
        let _ = std::fs::write(&mimeapps, cleaned);
    }

    ShellIntegrationResult {
        ok: true,
        platform: "linux".to_string(),
        path: None,
        error: None,
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn register_impl(_app: &tauri::AppHandle) -> ShellIntegrationResult {
    ShellIntegrationResult {
        ok: false,
        platform: env::consts::OS.to_string(),
        path: None,
        error: Some("shell integration not implemented on this platform".to_string()),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn unregister_impl(_app: &tauri::AppHandle) -> ShellIntegrationResult {
    ShellIntegrationResult {
        ok: false,
        platform: env::consts::OS.to_string(),
        path: None,
        error: Some("shell integration not implemented on this platform".to_string()),
    }
}

#[tauri::command]
pub fn register_context_menu(app: tauri::AppHandle) -> ShellIntegrationResult {
    let result = register_impl(&app);
    tracing::info!("register_context_menu -> {:?}", result);
    result
}

#[tauri::command]
pub fn unregister_context_menu(app: tauri::AppHandle) -> ShellIntegrationResult {
    let result = unregister_impl(&app);
    tracing::info!("unregister_context_menu -> {:?}", result);
    result
}

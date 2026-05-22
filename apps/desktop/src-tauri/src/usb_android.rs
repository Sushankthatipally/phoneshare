// Android USB transport bridge: wraps `adb` to detect connected phones and
// install an `adb reverse` tunnel so the phone can reach the desktop backend
// on 127.0.0.1:17619 over the cable.
//
// All commands are non-panicking: if `adb` is missing or fails, we return a
// structured `state: "absent" | "error"` payload instead of erroring out.

use serde::Serialize;
use tokio::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const ADB_BINARY: &str = "adb";
const BACKEND_PORT: u16 = 17619;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidStatus {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelResult {
    pub ok: bool,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStopResult {
    pub ok: bool,
}

fn build_adb_command(args: &[&str]) -> Command {
    let mut cmd = Command::new(ADB_BINARY);
    cmd.args(args);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

async fn adb_available() -> bool {
    build_adb_command(&["version"])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Parses the table output of `adb devices -l`. Returns a list of
/// `(serial, state, friendly_label)` triples, where `state` is one of
/// `device`, `unauthorized`, `offline`, etc.
async fn list_devices() -> Result<Vec<(String, String, String)>, String> {
    let output = build_adb_command(&["devices", "-l"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();

    for line in text.lines().skip(1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let Some(serial) = parts.next() else { continue };
        let Some(state) = parts.next() else { continue };

        let mut label = serial.to_string();
        for token in parts {
            if let Some(model) = token.strip_prefix("model:") {
                label = model.replace('_', " ");
                break;
            }
        }

        devices.push((serial.to_string(), state.to_string(), label));
    }

    Ok(devices)
}

#[tauri::command]
pub async fn usb_android_status() -> AndroidStatus {
    if !adb_available().await {
        return AndroidStatus {
            state: "absent".to_string(),
            device_label: None,
            error: Some("adb not found in PATH".to_string()),
        };
    }

    match list_devices().await {
        Ok(devices) if devices.is_empty() => AndroidStatus {
            state: "absent".to_string(),
            device_label: None,
            error: None,
        },
        Ok(devices) => {
            // Prefer an authorized device; fall back to the first unauthorized.
            if let Some((_, _, label)) = devices.iter().find(|(_, s, _)| s == "device") {
                AndroidStatus {
                    state: "ready".to_string(),
                    device_label: Some(label.clone()),
                    error: None,
                }
            } else if let Some((_, s, label)) = devices
                .iter()
                .find(|(_, s, _)| s == "unauthorized" || s == "authorizing")
            {
                let state = if s == "unauthorized" {
                    "authorizing"
                } else {
                    "authorizing"
                };
                AndroidStatus {
                    state: state.to_string(),
                    device_label: Some(label.clone()),
                    error: None,
                }
            } else {
                let (_, state, label) = &devices[0];
                AndroidStatus {
                    state: "detected".to_string(),
                    device_label: Some(label.clone()),
                    error: Some(format!("adb device state: {state}")),
                }
            }
        }
        Err(e) => AndroidStatus {
            state: "error".to_string(),
            device_label: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
pub async fn usb_android_ensure_tunnel() -> TunnelResult {
    if !adb_available().await {
        return TunnelResult {
            ok: false,
            host: "127.0.0.1".to_string(),
            port: BACKEND_PORT,
            error: Some("adb not found in PATH".to_string()),
        };
    }

    if let Err(e) = build_adb_command(&["start-server"]).output().await {
        return TunnelResult {
            ok: false,
            host: "127.0.0.1".to_string(),
            port: BACKEND_PORT,
            error: Some(format!("adb start-server failed: {e}")),
        };
    }

    let port_spec = format!("tcp:{BACKEND_PORT}");
    let output = match build_adb_command(&["reverse", &port_spec, &port_spec])
        .output()
        .await
    {
        Ok(o) => o,
        Err(e) => {
            return TunnelResult {
                ok: false,
                host: "127.0.0.1".to_string(),
                port: BACKEND_PORT,
                error: Some(format!("adb reverse failed: {e}")),
            };
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return TunnelResult {
            ok: false,
            host: "127.0.0.1".to_string(),
            port: BACKEND_PORT,
            error: Some(if stderr.is_empty() {
                "adb reverse returned non-zero exit".to_string()
            } else {
                stderr
            }),
        };
    }

    TunnelResult {
        ok: true,
        host: "127.0.0.1".to_string(),
        port: BACKEND_PORT,
        error: None,
    }
}

#[tauri::command]
pub async fn usb_android_stop_tunnel() -> TunnelStopResult {
    if !adb_available().await {
        return TunnelStopResult { ok: false };
    }

    let port_spec = format!("tcp:{BACKEND_PORT}");
    let ok = build_adb_command(&["reverse", "--remove", &port_spec])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    TunnelStopResult { ok }
}

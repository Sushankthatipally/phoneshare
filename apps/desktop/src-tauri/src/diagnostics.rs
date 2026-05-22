// Diagnostics support: log piping (forwarding tracing records into a Tauri event
// channel + bounded ring buffer the UI can pull), TCP-bind firewall probes, USB
// status, and the "run diagnose script" helper.

use std::{
    collections::{HashMap, VecDeque},
    io::{self, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    sync::{Arc, Mutex, OnceLock},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command;
use tracing::field::{Field, Visit};
use tracing_subscriber::Layer;

use crate::usb_android::UsbAndroidBridge;

const LOG_RING_CAPACITY: usize = 500;
const LOG_EVENT: &str = "dropbeam:log";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRecord {
    pub ts: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

#[derive(Default)]
pub struct LogRingBuffer {
    inner: Mutex<VecDeque<LogRecord>>,
}

impl LogRingBuffer {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(VecDeque::with_capacity(LOG_RING_CAPACITY)),
        }
    }

    pub fn push(&self, record: LogRecord) {
        let mut guard = self.inner.lock().expect("LogRingBuffer lock poisoned");
        if guard.len() == LOG_RING_CAPACITY {
            guard.pop_front();
        }
        guard.push_back(record);
    }

    pub fn snapshot(&self) -> Vec<LogRecord> {
        self.inner
            .lock()
            .expect("LogRingBuffer lock poisoned")
            .iter()
            .cloned()
            .collect()
    }
}

#[derive(Clone)]
pub struct LogBridge {
    buffer: Arc<LogRingBuffer>,
    app: Arc<Mutex<Option<AppHandle>>>,
}

impl LogBridge {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(LogRingBuffer::new()),
            app: Arc::new(Mutex::new(None)),
        }
    }

    pub fn buffer(&self) -> Arc<LogRingBuffer> {
        self.buffer.clone()
    }

    pub fn attach(&self, app: AppHandle) {
        if let Ok(mut guard) = self.app.lock() {
            *guard = Some(app);
        }
    }

    pub fn emit(&self, record: LogRecord) {
        self.buffer.push(record.clone());
        let handle = self.app.lock().ok().and_then(|guard| guard.clone());
        if let Some(app) = handle {
            let _ = app.emit(LOG_EVENT, record);
        }
    }
}

static LOG_BRIDGE: OnceLock<LogBridge> = OnceLock::new();

pub fn log_bridge() -> &'static LogBridge {
    LOG_BRIDGE.get_or_init(LogBridge::new)
}

struct LogVisitor {
    message: String,
    extras: Vec<(String, String)>,
}

impl Visit for LogVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        } else {
            self.extras.push((field.name().to_string(), format!("{value:?}")));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.extras.push((field.name().to_string(), value.to_string()));
        }
    }
}

pub struct BridgeLayer;

impl<S> Layer<S> for BridgeLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let metadata = event.metadata();
        let mut visitor = LogVisitor {
            message: String::new(),
            extras: Vec::new(),
        };
        event.record(&mut visitor);

        let message = if visitor.extras.is_empty() {
            visitor.message
        } else {
            let extras = visitor
                .extras
                .into_iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(" ");
            if visitor.message.is_empty() {
                extras
            } else {
                format!("{} {}", visitor.message, extras)
            }
        };

        let record = LogRecord {
            ts: Utc::now().to_rfc3339(),
            level: metadata.level().to_string().to_lowercase(),
            target: metadata.target().to_string(),
            message,
        };

        log_bridge().emit(record);
    }
}

// Captures sidecar stdout/stderr line-by-line and forwards each line as a
// structured log record. Reserved for future use; today the sidecar lines flow
// through `tracing::info!(target: "sidecar", ...)` in main.rs which the
// BridgeLayer already picks up.
#[derive(Clone)]
#[allow(dead_code)]
pub struct SidecarWriter {
    level: String,
    target: String,
    buffer: Arc<Mutex<Vec<u8>>>,
}

impl SidecarWriter {
    #[allow(dead_code)]
    pub fn new(level: impl Into<String>, target: impl Into<String>) -> Self {
        Self {
            level: level.into(),
            target: target.into(),
            buffer: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl Write for SidecarWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut guard = self.buffer.lock().map_err(|_| io::ErrorKind::Other)?;
        guard.extend_from_slice(buf);
        while let Some(pos) = guard.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = guard.drain(..=pos).collect();
            let text = String::from_utf8_lossy(&line[..line.len().saturating_sub(1)])
                .trim_end()
                .to_string();
            if !text.is_empty() {
                log_bridge().emit(LogRecord {
                    ts: Utc::now().to_rfc3339(),
                    level: self.level.clone(),
                    target: self.target.clone(),
                    message: text,
                });
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallStatus {
    pub port: u16,
    pub bindable: bool,
    pub error: Option<String>,
}

fn probe_port(port: u16) -> FirewallStatus {
    match TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port)) {
        Ok(listener) => {
            drop(listener);
            FirewallStatus {
                port,
                bindable: true,
                error: None,
            }
        }
        Err(error) => FirewallStatus {
            port,
            bindable: false,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
pub fn firewall_check_ports(ports: Vec<u16>) -> HashMap<u16, FirewallStatus> {
    ports
        .into_iter()
        .map(|port| (port, probe_port(port)))
        .collect()
}

#[tauri::command]
pub fn diagnostics_log_snapshot(buffer: State<'_, Arc<LogRingBuffer>>) -> Vec<LogRecord> {
    buffer.snapshot()
}

#[tauri::command]
pub async fn usb_android_status(
    bridge: State<'_, UsbAndroidBridge>,
) -> Result<crate::usb_android::UsbAndroidStatus, String> {
    Ok(bridge.status().await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct RunDiagnoseInput {
    pub data_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDiagnoseResult {
    pub script: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

fn locate_diagnose_script(app: &AppHandle, filename: &str) -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("scripts").join(filename));
        candidates.push(resource_dir.join(filename));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("scripts").join(filename));
            candidates.push(parent.join(filename));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("apps/desktop/scripts").join(filename));
        candidates.push(cwd.join("scripts").join(filename));
    }

    candidates.into_iter().find(|path| path.exists())
}

#[tauri::command]
pub async fn run_diagnose_script(
    app: AppHandle,
    _input: Option<RunDiagnoseInput>,
) -> Result<RunDiagnoseResult, String> {
    #[cfg(windows)]
    let filename = "diagnose-windows.ps1";
    #[cfg(not(windows))]
    let filename = "diagnose-mac.sh";

    let script_path = locate_diagnose_script(&app, filename)
        .ok_or_else(|| format!("diagnose script '{filename}' not found in resource bundle"))?;

    #[cfg(windows)]
    let (program, args) = (
        "powershell.exe".to_string(),
        vec![
            "-NoLogo".to_string(),
            "-NonInteractive".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            script_path.to_string_lossy().to_string(),
        ],
    );

    #[cfg(not(windows))]
    let (program, args) = (
        "bash".to_string(),
        vec![script_path.to_string_lossy().to_string()],
    );

    let output = Command::new(&program)
        .args(&args)
        .output()
        .await
        .map_err(|error| format!("failed to launch {program}: {error}"))?;

    Ok(RunDiagnoseResult {
        script: script_path.to_string_lossy().to_string(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

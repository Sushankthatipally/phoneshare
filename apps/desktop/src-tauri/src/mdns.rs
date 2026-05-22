use std::{
    collections::HashMap,
    net::IpAddr,
    sync::Mutex,
    thread,
    time::Duration,
};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const SERVICE_TYPE: &str = "_dropbeam._tcp.local.";
const SERVICE_PORT: u16 = 17619;
const CRATE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct MdnsState {
    inner: Mutex<Option<MdnsInner>>,
}

struct MdnsInner {
    daemon: ServiceDaemon,
    fullname: String,
}

impl MdnsState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerFound {
    pub fullname: String,
    pub name: String,
    pub id: String,
    pub icon: String,
    pub transports: Vec<String>,
    pub version: String,
    pub host: String,
    pub addresses: Vec<String>,
    pub port: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerGone {
    pub fullname: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MdnsStatus {
    pub enabled: bool,
    pub service_type: String,
    pub instance: Option<String>,
    pub port: u16,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdnsInitArgs {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

#[tauri::command]
pub fn init_mdns(
    app: AppHandle,
    state: State<'_, MdnsState>,
    args: MdnsInitArgs,
) -> Result<MdnsStatus, String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        let inner = guard.as_ref().unwrap();
        return Ok(MdnsStatus {
            enabled: true,
            service_type: SERVICE_TYPE.to_string(),
            instance: Some(inner.fullname.clone()),
            port: SERVICE_PORT,
        });
    }

    let daemon = ServiceDaemon::new().map_err(|e| format!("mdns daemon: {e}"))?;

    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "dropbeam-desktop".to_string());
    let display_name = args.device_name.unwrap_or_else(|| hostname.clone());
    let device_id = args
        .device_id
        .unwrap_or_else(|| format!("dropbeam:{hostname}"));
    let icon = args.icon.unwrap_or_else(|| "desktop".to_string());

    let instance_name = sanitize_instance(&device_id);
    let host_name = format!("{}.local.", sanitize_hostname(&hostname));

    let mut txt: HashMap<String, String> = HashMap::new();
    txt.insert("name".into(), display_name);
    txt.insert("id".into(), device_id);
    txt.insert("icon".into(), icon);
    txt.insert("transports".into(), "wifi,usb".into());
    txt.insert("version".into(), CRATE_VERSION.to_string());

    let local_ips = local_ipv4_addrs();
    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name,
        &host_name,
        local_ips.as_slice(),
        SERVICE_PORT,
        Some(txt),
    )
    .map_err(|e| format!("service info: {e}"))?
    .enable_addr_auto();

    let fullname = info.get_fullname().to_string();

    daemon
        .register(info)
        .map_err(|e| format!("register: {e}"))?;

    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("browse: {e}"))?;

    let app_for_thread = app.clone();
    let own_fullname = fullname.clone();
    thread::spawn(move || {
        while let Ok(event) = receiver.recv() {
            match event {
                ServiceEvent::ServiceResolved(info) => {
                    if info.get_fullname() == own_fullname {
                        continue;
                    }
                    let txt_map: HashMap<String, String> = info
                        .get_properties()
                        .iter()
                        .map(|p| (p.key().to_string(), p.val_str().to_string()))
                        .collect();
                    let payload = PeerFound {
                        fullname: info.get_fullname().to_string(),
                        name: txt_map.get("name").cloned().unwrap_or_default(),
                        id: txt_map.get("id").cloned().unwrap_or_default(),
                        icon: txt_map
                            .get("icon")
                            .cloned()
                            .unwrap_or_else(|| "desktop".to_string()),
                        transports: txt_map
                            .get("transports")
                            .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
                            .unwrap_or_default(),
                        version: txt_map.get("version").cloned().unwrap_or_default(),
                        host: info.get_hostname().to_string(),
                        addresses: info
                            .get_addresses()
                            .iter()
                            .map(|a| a.to_string())
                            .collect(),
                        port: info.get_port(),
                    };
                    let _ = app_for_thread.emit("dropbeam:peer-found", payload);
                }
                ServiceEvent::ServiceRemoved(_type, fullname) => {
                    if fullname == own_fullname {
                        continue;
                    }
                    let _ = app_for_thread
                        .emit("dropbeam:peer-gone", PeerGone { fullname });
                }
                _ => {}
            }
        }
    });

    *guard = Some(MdnsInner {
        daemon,
        fullname: fullname.clone(),
    });

    Ok(MdnsStatus {
        enabled: true,
        service_type: SERVICE_TYPE.to_string(),
        instance: Some(fullname),
        port: SERVICE_PORT,
    })
}

#[tauri::command]
pub fn shutdown_mdns(state: State<'_, MdnsState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(inner) = guard.take() {
        let _ = inner.daemon.unregister(&inner.fullname);
        thread::sleep(Duration::from_millis(150));
        let _ = inner.daemon.shutdown();
    }
    Ok(())
}

pub fn shutdown_from_handle(app: &AppHandle) {
    if let Some(state) = app.try_state::<MdnsState>() {
        let _ = shutdown_mdns(state);
    }
}

fn sanitize_instance(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "dropbeam".to_string()
    } else {
        cleaned
    }
}

fn sanitize_hostname(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "dropbeam-desktop".to_string()
    } else {
        cleaned
    }
}

fn local_ipv4_addrs() -> Vec<IpAddr> {
    use std::net::{Ipv4Addr, UdpSocket};
    let mut addrs: Vec<IpAddr> = Vec::new();
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(local) = sock.local_addr() {
                if let IpAddr::V4(v4) = local.ip() {
                    if v4 != Ipv4Addr::UNSPECIFIED && !v4.is_loopback() {
                        addrs.push(IpAddr::V4(v4));
                    }
                }
            }
        }
    }
    addrs
}

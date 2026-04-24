mod crypto;
mod mdns;
mod pairing;
mod qr;
mod server;
mod transfer;
mod usb_android;
mod usb_ios;

use std::{
    env,
    net::{IpAddr, Ipv4Addr},
    path::PathBuf,
};

use anyhow::{Context, Result};
use server::{run_backend, BackendConfig};
use transfer::{DeviceIdentity, DeviceKind};

fn main() {
    install_tracing();

    tauri::Builder::default()
        .setup(|_app| {
            let config = build_config().map_err(|error| std::io::Error::other(error.to_string()))?;

            tauri::async_runtime::spawn(async move {
                if let Err(error) = run_backend(config).await {
                    tracing::error!("dropbeam backend terminated: {error}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run DropBeam desktop");
}

fn install_tracing() {
    let filter = env::var("DROPBEAM_LOG").unwrap_or_else(|_| "info,tower_http=info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}

fn build_config() -> Result<BackendConfig> {
    let bind_host = env::var("DROPBEAM_BIND_HOST")
        .ok()
        .and_then(|value| value.parse::<IpAddr>().ok())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let port = env::var("DROPBEAM_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(17619);
    let discovery_port = env::var("DROPBEAM_DISCOVERY_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(38251);
    let android_device_port = env::var("DROPBEAM_ANDROID_DEVICE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(17619);
    let ios_device_port = env::var("DROPBEAM_IOS_DEVICE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(17619);
    let static_root = env::var("DROPBEAM_STATIC_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("../dist"));
    let download_root = env::var("DROPBEAM_DOWNLOAD_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./dropbeam-downloads"));
    let device_name = env::var("DROPBEAM_DEVICE_NAME").unwrap_or_else(|_| resolve_hostname());
    let device_id = env::var("DROPBEAM_DEVICE_ID").unwrap_or_else(|_| format!("desktop-{}", uuid::Uuid::new_v4().simple()));
    let adb_binary = env::var("DROPBEAM_ADB_BINARY").unwrap_or_else(|_| "adb".to_string());
    let iproxy_binary = env::var("DROPBEAM_IPROXY_BINARY").unwrap_or_else(|_| "iproxy".to_string());

    Ok(BackendConfig {
        bind_host,
        port,
        static_root,
        download_root,
        local_device: DeviceIdentity {
            id: device_id,
            kind: DeviceKind::Desktop,
            name: device_name,
            platform: Some(env::consts::OS.to_string()),
            is_local: true,
        },
        discovery_port,
        adb_binary,
        android_device_port,
        iproxy_binary,
        ios_device_port,
    })
}

fn resolve_hostname() -> String {
    hostname::get()
        .context("failed to resolve local hostname")
        .ok()
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "DropBeam Desktop".to_string())
}

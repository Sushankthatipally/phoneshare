use std::{process::Stdio, sync::Arc};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbIosStatus {
    pub usbmux_required: bool,
    pub iproxy_binary: String,
    pub available: bool,
    pub host_port: u16,
    pub device_port: u16,
    pub tunnel_state: String,
}

#[derive(Debug, Clone)]
pub struct UsbIosBridge {
    iproxy_binary: String,
    host_port: u16,
    device_port: u16,
    tunnel_process: Arc<Mutex<Option<Child>>>,
}

impl UsbIosBridge {
    pub fn new(iproxy_binary: impl Into<String>, host_port: u16, device_port: u16) -> Self {
        Self {
            iproxy_binary: iproxy_binary.into(),
            host_port,
            device_port,
            tunnel_process: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn status(&self) -> UsbIosStatus {
        let available = self.detect_iproxy().await.is_ok();
        let tunnel_state = if !available {
            "iproxy-unavailable".to_string()
        } else if self.tunnel_process.lock().await.is_some() {
            "forward-active".to_string()
        } else {
            "ready".to_string()
        };

        UsbIosStatus {
            usbmux_required: true,
            iproxy_binary: self.iproxy_binary.clone(),
            available,
            host_port: self.host_port,
            device_port: self.device_port,
            tunnel_state,
        }
    }

    pub async fn ensure_forward_tunnel(&self) -> Result<UsbIosStatus> {
        self.detect_iproxy().await?;

        let mut guard = self.tunnel_process.lock().await;
        if guard.is_none() {
            let child = Command::new(&self.iproxy_binary)
                .arg(self.host_port.to_string())
                .arg(self.device_port.to_string())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .with_context(|| format!("failed to launch {}", self.iproxy_binary))?;
            *guard = Some(child);
        }
        drop(guard);

        Ok(UsbIosStatus {
            usbmux_required: true,
            iproxy_binary: self.iproxy_binary.clone(),
            available: true,
            host_port: self.host_port,
            device_port: self.device_port,
            tunnel_state: "forward-active".to_string(),
        })
    }

    pub async fn stop_forward_tunnel(&self) -> Result<()> {
        let mut guard = self.tunnel_process.lock().await;
        let Some(mut child) = guard.take() else {
            return Ok(());
        };

        child
            .kill()
            .await
            .context("failed to stop iproxy tunnel")?;
        Ok(())
    }

    async fn detect_iproxy(&self) -> Result<()> {
        let output = Command::new(&self.iproxy_binary)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await
            .with_context(|| format!("failed to execute {}", self.iproxy_binary))?;

        if !output.status.success() {
            bail!("{} is installed but returned a non-zero exit code", self.iproxy_binary);
        }

        Ok(())
    }
}

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbAndroidStatus {
    pub adb_required: bool,
    pub adb_binary: String,
    pub available: bool,
    pub connected_devices: Vec<String>,
    pub host_port: u16,
    pub device_port: u16,
    pub tunnel_state: String,
}

#[derive(Debug, Clone)]
pub struct UsbAndroidBridge {
    adb_binary: String,
    host_port: u16,
    device_port: u16,
}

impl UsbAndroidBridge {
    pub fn new(adb_binary: impl Into<String>, host_port: u16, device_port: u16) -> Self {
        Self {
            adb_binary: adb_binary.into(),
            host_port,
            device_port,
        }
    }

    pub async fn status(&self) -> UsbAndroidStatus {
        let available = self.run_adb(["version"]).await.is_ok();
        let connected_devices = self.connected_devices().await.unwrap_or_default();
        let tunnel_state = if !available {
            "adb-unavailable".to_string()
        } else if connected_devices.is_empty() {
            "no-device".to_string()
        } else {
            "ready".to_string()
        };

        UsbAndroidStatus {
            adb_required: true,
            adb_binary: self.adb_binary.clone(),
            available,
            connected_devices,
            host_port: self.host_port,
            device_port: self.device_port,
            tunnel_state,
        }
    }

    pub async fn ensure_reverse_tunnel(&self) -> Result<UsbAndroidStatus> {
        self.run_adb(["start-server"]).await?;

        let devices = self.connected_devices().await?;
        if devices.is_empty() {
            bail!("adb did not report any connected Android devices");
        }

        let device_spec = format!("tcp:{}", self.device_port);
        let host_spec = format!("tcp:{}", self.host_port);
        self.run_adb(["reverse", device_spec.as_str(), host_spec.as_str()])
        .await
        .context("failed to establish adb reverse tunnel")?;

        Ok(UsbAndroidStatus {
            adb_required: true,
            adb_binary: self.adb_binary.clone(),
            available: true,
            connected_devices: devices,
            host_port: self.host_port,
            device_port: self.device_port,
            tunnel_state: "reverse-active".to_string(),
        })
    }

    pub async fn remove_reverse_tunnel(&self) -> Result<()> {
        let device_spec = format!("tcp:{}", self.device_port);
        self.run_adb(["reverse", "--remove", device_spec.as_str()])
            .await
            .context("failed to remove adb reverse tunnel")?;
        Ok(())
    }

    async fn connected_devices(&self) -> Result<Vec<String>> {
        let output = self.run_adb(["devices"]).await?;
        let devices = output
            .lines()
            .skip(1)
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }

                let mut segments = trimmed.split_whitespace();
                let serial = segments.next()?;
                let status = segments.next().unwrap_or_default();
                (status == "device").then(|| serial.to_string())
            })
            .collect::<Vec<_>>();

        Ok(devices)
    }

    async fn run_adb<I, S>(&self, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let arguments = args
            .into_iter()
            .map(|value| value.as_ref().to_string())
            .collect::<Vec<_>>();
        let output = Command::new(&self.adb_binary)
            .args(&arguments)
            .output()
            .await
            .with_context(|| format!("failed to execute {}", self.adb_binary))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            bail!(
                "{} {} failed: {}",
                self.adb_binary,
                arguments.join(" "),
                if stderr.is_empty() { "unknown adb error" } else { &stderr }
            );
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

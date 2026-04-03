use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::{
    net::UdpSocket,
    sync::RwLock,
    task::JoinHandle,
    time,
};

use crate::transfer::DeviceIdentity;

const DEFAULT_DISCOVERY_PORT: u16 = 38_251;
const DISCOVERY_PROTOCOL: &str = "dropbeam.discovery.v1";
const DISCOVERY_TTL_SECONDS: i64 = 12;
const ANNOUNCE_INTERVAL: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryAdvertisement {
    pub protocol: String,
    pub device: DeviceIdentity,
    pub host: String,
    pub service_port: u16,
    pub transport: String,
    pub generated_at: String,
    pub ttl_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPeer {
    pub device: DeviceIdentity,
    pub host: String,
    pub port: u16,
    pub transport: String,
    pub source: String,
    pub seen_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryStatus {
    pub enabled: bool,
    pub bind_address: String,
    pub advertise_host: String,
    pub discovery_port: u16,
    pub service_port: u16,
    pub peer_count: usize,
}

#[derive(Debug)]
pub struct DiscoveryRuntime {
    tasks: Vec<JoinHandle<()>>,
}

impl DiscoveryRuntime {
    pub async fn shutdown(self) {
        for task in self.tasks {
            task.abort();
            let _ = task.await;
        }
    }
}

#[derive(Debug, Clone)]
pub struct DiscoveryService {
    local_device: DeviceIdentity,
    bind_address: String,
    advertise_host: String,
    service_port: u16,
    discovery_port: u16,
    peers: Arc<RwLock<HashMap<String, DiscoveredPeer>>>,
}

impl DiscoveryService {
    pub fn new(
        local_device: DeviceIdentity,
        bind_address: impl Into<String>,
        service_port: u16,
        discovery_port: Option<u16>,
    ) -> Self {
        let bind_address = bind_address.into();
        let advertise_host = resolve_advertise_host(&bind_address);

        Self {
            local_device,
            bind_address,
            advertise_host,
            service_port,
            discovery_port: discovery_port.unwrap_or(DEFAULT_DISCOVERY_PORT),
            peers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn spawn(&self) -> Result<DiscoveryRuntime> {
        let broadcaster = UdpSocket::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)))
            .await
            .context("failed to bind LAN discovery broadcaster")?;
        broadcaster
            .set_broadcast(true)
            .context("failed to enable LAN discovery broadcast mode")?;
        let broadcast_target = SocketAddr::from((Ipv4Addr::BROADCAST, self.discovery_port));
        let broadcast_service = self.clone();
        let broadcast_task = tokio::spawn(async move {
            loop {
                let packet = match serde_json::to_vec(&broadcast_service.build_advertisement()) {
                    Ok(packet) => packet,
                    Err(error) => {
                        tracing::warn!("failed to serialize discovery advertisement: {error}");
                        time::sleep(ANNOUNCE_INTERVAL).await;
                        continue;
                    }
                };

                if let Err(error) = broadcaster.send_to(&packet, broadcast_target).await {
                    tracing::warn!("failed to broadcast discovery advertisement: {error}");
                }

                time::sleep(ANNOUNCE_INTERVAL).await;
            }
        });

        let listener = UdpSocket::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, self.discovery_port)))
            .await
            .context("failed to bind LAN discovery listener")?;
        let listener_service = self.clone();
        let listener_task = tokio::spawn(async move {
            let mut buffer = vec![0_u8; 4096];

            loop {
                match listener.recv_from(&mut buffer).await {
                    Ok((length, source)) => {
                        if let Err(error) = listener_service.record_peer_packet(&buffer[..length], source).await {
                            tracing::debug!("ignoring invalid discovery packet from {source}: {error}");
                        }
                    }
                    Err(error) => {
                        tracing::warn!("LAN discovery listener error: {error}");
                        time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });

        Ok(DiscoveryRuntime {
            tasks: vec![broadcast_task, listener_task],
        })
    }

    pub async fn status(&self) -> DiscoveryStatus {
        DiscoveryStatus {
            enabled: true,
            bind_address: self.bind_address.clone(),
            advertise_host: self.advertise_host.clone(),
            discovery_port: self.discovery_port,
            service_port: self.service_port,
            peer_count: self.list_peers().await.len(),
        }
    }

    pub async fn list_peers(&self) -> Vec<DiscoveredPeer> {
        self.prune_expired().await;

        let mut peers = self
            .peers
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        peers.sort_by(|left, right| right.seen_at.cmp(&left.seen_at));
        peers
    }

    fn build_advertisement(&self) -> DiscoveryAdvertisement {
        DiscoveryAdvertisement {
            protocol: DISCOVERY_PROTOCOL.to_string(),
            device: self.local_device.clone(),
            host: self.advertise_host.clone(),
            service_port: self.service_port,
            transport: "wifi".to_string(),
            generated_at: Utc::now().to_rfc3339(),
            ttl_seconds: DISCOVERY_TTL_SECONDS,
        }
    }

    async fn record_peer_packet(&self, packet: &[u8], source: SocketAddr) -> Result<()> {
        let advertisement = serde_json::from_slice::<DiscoveryAdvertisement>(packet)
            .context("failed to decode discovery advertisement")?;

        if advertisement.protocol != DISCOVERY_PROTOCOL {
            anyhow::bail!("unsupported discovery protocol");
        }

        if advertisement.device.id == self.local_device.id {
            return Ok(());
        }

        let seen_at = Utc::now();
        let expires_at = seen_at + chrono::Duration::seconds(advertisement.ttl_seconds);
        let host = if advertisement.host.trim().is_empty() {
            source.ip().to_string()
        } else {
            advertisement.host
        };

        self.peers.write().await.insert(
            advertisement.device.id.clone(),
            DiscoveredPeer {
                device: advertisement.device,
                host,
                port: advertisement.service_port,
                transport: advertisement.transport,
                source: source.ip().to_string(),
                seen_at: seen_at.to_rfc3339(),
                expires_at: expires_at.to_rfc3339(),
            },
        );

        Ok(())
    }

    async fn prune_expired(&self) {
        let now = Utc::now();
        self.peers.write().await.retain(|_, peer| {
            peer.expires_at
                .parse::<DateTime<Utc>>()
                .map(|expiry| expiry > now)
                .unwrap_or(false)
        });
    }
}

fn resolve_advertise_host(bind_address: &str) -> String {
    if bind_address != "0.0.0.0" {
        return bind_address.to_string();
    }

    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        })
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

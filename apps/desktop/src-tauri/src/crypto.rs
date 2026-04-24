use std::time::Duration;

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use x25519_dalek::{PublicKey, StaticSecret};

const AES_NONCE_BYTES: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingPayload {
    pub session_id: String,
    pub transport: String,
    pub host: String,
    pub port: u16,
    pub public_key: String,
    pub expires_at: String,
}

#[derive(Clone)]
pub struct KeyAgreement {
    secret_key: StaticSecret,
    pub public_key: PublicKey,
}

impl std::fmt::Debug for KeyAgreement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyAgreement")
            .field("secret_key", &"<redacted>")
            .field("public_key", &export_public_key(&self.public_key))
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct SessionKey {
    pub algorithm: &'static str,
    pub key_id: String,
    pub public_key: String,
    key_bytes: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedChunk {
    pub chunk_index: u64,
    pub nonce: String,
    pub ciphertext: String,
}

impl SessionKey {
    pub fn new(key_id: impl Into<String>, public_key: impl Into<String>, key_bytes: [u8; 32]) -> Self {
        Self {
            algorithm: "x25519-hkdf-sha256/aes-256-gcm",
            key_id: key_id.into(),
            public_key: public_key.into(),
            key_bytes,
        }
    }

    pub fn raw_key(&self) -> &[u8; 32] {
        &self.key_bytes
    }
}

pub fn generate_key_agreement() -> KeyAgreement {
    let secret_key = StaticSecret::random_from_rng(OsRng);
    let public_key = PublicKey::from(&secret_key);

    KeyAgreement {
        secret_key,
        public_key,
    }
}

pub fn export_public_key(public_key: &PublicKey) -> String {
    URL_SAFE_NO_PAD.encode(public_key.as_bytes())
}

pub fn build_pairing_payload(
    host: impl Into<String>,
    port: u16,
    transport: impl Into<String>,
    public_key: impl Into<String>,
    ttl: Duration,
) -> PairingPayload {
    let expires_at = Utc::now() + chrono::Duration::from_std(ttl).unwrap_or_else(|_| chrono::Duration::minutes(10));

    PairingPayload {
        session_id: format!("session-{}", Uuid::new_v4().simple()),
        transport: transport.into(),
        host: host.into(),
        port,
        public_key: public_key.into(),
        expires_at: expires_at.to_rfc3339(),
    }
}

pub fn parse_pairing_expiry(payload: &PairingPayload) -> Result<DateTime<Utc>> {
    payload
        .expires_at
        .parse::<DateTime<Utc>>()
        .context("failed to parse pairing expiry timestamp")
}

pub fn derive_session_key(
    local_keys: &KeyAgreement,
    remote_public_key_b64: &str,
    session_id: &str,
) -> Result<SessionKey> {
    let remote_public_key = import_public_key(remote_public_key_b64)?;
    let shared_secret = local_keys.secret_key.diffie_hellman(&remote_public_key);
    let mut key_bytes = [0_u8; 32];

    let hkdf = Hkdf::<Sha256>::new(Some(session_id.as_bytes()), shared_secret.as_bytes());
    hkdf.expand(b"dropbeam-session-key", &mut key_bytes)
        .map_err(|_| anyhow!("failed to derive AES session key"))?;

    let fingerprint = sha2::Sha256::digest(shared_secret.as_bytes());
    let key_id = hex::encode(&fingerprint[..8]);

    Ok(SessionKey::new(
        key_id,
        export_public_key(&local_keys.public_key),
        key_bytes,
    ))
}

pub fn encrypt_chunk(
    session_key: &SessionKey,
    session_id: &str,
    file_id: &str,
    chunk_index: u64,
    plaintext: &[u8],
) -> Result<EncryptedChunk> {
    let cipher = Aes256Gcm::new_from_slice(session_key.raw_key())
        .map_err(|_| anyhow!("failed to initialize AES-256-GCM"))?;
    let mut nonce_bytes = [0_u8; AES_NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce_bytes);
    let aad = format!("{session_id}:{file_id}:{chunk_index}");

    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| anyhow!("failed to encrypt transfer chunk"))?;

    Ok(EncryptedChunk {
        chunk_index,
        nonce: URL_SAFE_NO_PAD.encode(nonce_bytes),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    })
}

pub fn decrypt_chunk(
    session_key: &SessionKey,
    session_id: &str,
    file_id: &str,
    chunk: &EncryptedChunk,
) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(session_key.raw_key())
        .map_err(|_| anyhow!("failed to initialize AES-256-GCM"))?;
    let nonce_bytes = decode_fixed_length::<AES_NONCE_BYTES>(&chunk.nonce)?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(chunk.ciphertext.as_bytes())
        .context("failed to decode encrypted chunk body")?;
    let aad = format!("{session_id}:{file_id}:{chunk_index}", chunk_index = chunk.chunk_index);

    cipher
        .decrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: ciphertext.as_ref(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| anyhow!("failed to decrypt transfer chunk"))
}

fn import_public_key(encoded_public_key: &str) -> Result<PublicKey> {
    let bytes = decode_fixed_length::<32>(encoded_public_key)?;
    Ok(PublicKey::from(bytes))
}

fn decode_fixed_length<const N: usize>(value: &str) -> Result<[u8; N]> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value.as_bytes())
        .context("failed to decode base64url data")?;

    bytes
        .try_into()
        .map_err(|_| anyhow!("decoded value did not match expected length"))
}

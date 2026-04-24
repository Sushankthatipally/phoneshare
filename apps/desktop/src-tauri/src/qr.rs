use anyhow::{Context, Result};

use crate::crypto::PairingPayload;

pub fn serialize_pairing_payload(payload: &PairingPayload) -> Result<String> {
    serde_json::to_string(payload).context("failed to serialize pairing payload")
}

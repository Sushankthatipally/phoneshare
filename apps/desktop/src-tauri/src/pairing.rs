use chrono::Utc;

use crate::transfer::{PairingDetails, PairingState};

pub fn build_pairing_details(session_id: String, expires_at: String, qr_payload: String) -> PairingDetails {
    PairingDetails {
        state: PairingState::Unpaired,
        session_id,
        expires_at,
        pin: None,
        qr_payload: Some(qr_payload),
        verified_at: None,
    }
}

pub fn mark_pairing_verified(details: &mut PairingDetails) {
    details.state = PairingState::Verified;
    details.verified_at = Some(Utc::now().to_rfc3339());
}

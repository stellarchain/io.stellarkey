use soroban_sdk::{BytesN, Env, contracttype};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofBytes {
    pub a: [u8; 64],
    pub b: [u8; 128],
    pub c: [u8; 64],
}

impl ProofBytes {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() != 256 {
            return Err("Proof must be exactly 256 bytes");
        }
        let mut a = [0u8; 64];
        let mut b = [0u8; 128];
        let mut c = [0u8; 64];

        a.copy_from_slice(&bytes[0..64]);
        b.copy_from_slice(&bytes[64..192]);
        c.copy_from_slice(&bytes[192..256]);

        Ok(ProofBytes { a, b, c })
    }

    pub fn to_bytes(&self) -> [u8; 256] {
        let mut out = [0u8; 256];
        out[0..64].copy_from_slice(&self.a);
        out[64..192].copy_from_slice(&self.b);
        out[192..256].copy_from_slice(&self.c);
        out
    }

    pub fn to_contract_proof(&self, env: &Env) -> Proof {
        Proof {
            a: BytesN::from_array(env, &self.a),
            b: BytesN::from_array(env, &self.b),
            c: BytesN::from_array(env, &self.c),
        }
    }
}

pub struct VerificationKey {
    pub alpha_g1: [u8; 64],
    pub beta_g2: [u8; 128],
    pub gamma_g2: [u8; 128],
    pub delta_g2: [u8; 128],
    pub gamma_abc: [[u8; 64]; 14],
}

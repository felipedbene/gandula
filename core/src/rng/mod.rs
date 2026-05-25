use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;

/// Single source of randomness for one match. Wraps `ChaCha8Rng` so the engine
/// can be seeded with a plain `u64` and the rest of the code never imports an
/// RNG type directly. Determinism guarantee: identical `seed` + identical
/// inputs → byte-identical event log.
pub struct MatchRng(ChaCha8Rng);

impl MatchRng {
    pub fn new(seed: u64) -> Self {
        Self(ChaCha8Rng::seed_from_u64(seed))
    }

    /// Uniform f64 in [0, 1).
    pub fn unit(&mut self) -> f64 {
        // 53-bit mantissa from a 64-bit draw — matches `rand::Rng::random::<f64>`.
        let bits = self.0.next_u64() >> 11;
        (bits as f64) * (1.0 / ((1u64 << 53) as f64))
    }

    /// Uniform integer in `[low, high)`.
    pub fn range_u32(&mut self, low: u32, high: u32) -> u32 {
        debug_assert!(high > low);
        let span = (high - low) as u64;
        low + (self.0.next_u64() % span) as u32
    }

    pub fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }

    /// Pick an index in `[0, weights.len())` proportional to weights. Weights
    /// must be non-negative; at least one must be > 0.
    pub fn weighted_pick(&mut self, weights: &[f64]) -> usize {
        let total: f64 = weights.iter().sum();
        debug_assert!(total > 0.0);
        let mut r = self.unit() * total;
        for (i, w) in weights.iter().enumerate() {
            r -= w;
            if r <= 0.0 {
                return i;
            }
        }
        weights.len() - 1
    }
}

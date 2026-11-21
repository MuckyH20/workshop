pub const VAULT_SEED: &[u8] = b"vault";
/// Shortest allowed check-in interval (1 minute).
pub const MIN_INTERVAL_SECS: i64 = 60;
/// Longest allowed check-in interval (~10 years).
pub const MAX_INTERVAL_SECS: i64 = 10 * 365 * 24 * 60 * 60;

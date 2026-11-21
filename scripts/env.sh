# Source me: puts Solana CLI, platform-tools rustc and the Anchor binary on PATH (works without rustup).
PT=$(ls -d "$HOME"/.cache/solana/v*/platform-tools 2>/dev/null | sort -V | head -n1)
export PATH="$PT/rust/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
export NO_DNA=1
build_sbf() { cargo-build-sbf --no-rustup-override --manifest-path programs/heartbeat/Cargo.toml "$@"; }

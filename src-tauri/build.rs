fn main() {
    tauri_build::build();

    // Re-run (and re-embed a fresh timestamp) whenever the source or manifest
    // actually changes, so REPO_LAUNCHER_BUILT_UNIX reflects the last real
    // compile rather than every incremental no-op `cargo build`.
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");

    let built_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    println!("cargo:rustc-env=REPO_LAUNCHER_BUILT_UNIX={built_unix}");
}

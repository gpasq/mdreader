fn main() {
    // The exe's icon resource and the window icon are compiled in; rebuild when they change.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=tauri.windows.conf.json");
    println!("cargo:rerun-if-changed=tauri.macos.conf.json");
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=Info.plist");
    tauri_build::build()
}

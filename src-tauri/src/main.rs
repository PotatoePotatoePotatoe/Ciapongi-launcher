#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    ciapongi_rp_launcher_lib::setup_linux_environment();

    ciapongi_rp_launcher_lib::run()
}


#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Workaround dla błędu WebKitGTK na kartach NVIDIA pod Waylandem (KDE Plasma/GNOME),
        // który powoduje całkowicie szare/puste okno (zawieszenie renderera DMA-BUF).
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    ciapongi_rp_launcher_lib::run()
}


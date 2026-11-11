pub mod auth_ms;
pub mod mc_launcher;
pub mod modrinth;
pub mod pack_sync;
pub mod state;
pub mod system;
pub mod updater;

use tauri::{Emitter, Manager};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::new(app.handle());
            app.manage(state);

            // Okresowe / startowe zadania w tle po inicjalizacji aplikacji
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let st = app_handle.state::<AppState>();

                // 1. Auto-update launchera (wyłącznie w wersji spakowanej Release)
                if st.is_packaged {
                    let cfg = {
                        let _g = st.config_lock.lock().await;
                        st.read_config()
                    };
                    if let Err(e) =
                        updater::run_update_check(&app_handle, &st, cfg.auto_update_launcher, true)
                            .await
                    {
                        st.log_to_file(&format!("[Updater] Startup check error: {e}"));
                    }
                } else {
                    st.log_to_file("[GithubUpdater] Dev mode — updater disabled.");
                }

                // 2. Automatyczne sprawdzenie i aktualizacja najnowszej stabilnej wersji Fabric Loader
                let cfg_mc = {
                    let _g = st.config_lock.lock().await;
                    st.read_config().minecraft_version
                };
                if let Some(latest) =
                    mc_launcher::get_latest_fabric_loader(&st.http_client, &cfg_mc).await
                {
                    let mut updated_cfg = None;
                    {
                        let _g = st.config_lock.lock().await;
                        let mut cfg = st.read_config();
                        if cfg.loader_version != latest {
                            st.log_to_file(&format!(
                                "[Fabric] Wykryto nowszą wersję Fabric: {} -> {latest}",
                                cfg.loader_version
                            ));
                            cfg.loader_version = latest;
                            if st.write_config(&cfg).is_ok() {
                                updated_cfg = Some(cfg);
                            }
                        }
                    }
                    if let Some(cfg_to_emit) = updated_cfg {
                        let _ = app_handle.emit("config-updated", cfg_to_emit);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Okno i system
            system::window_minimize,
            system::window_maximize,
            system::window_close,
            system::get_config,
            system::save_config,
            system::get_system_ram,
            system::get_system_specs,
            system::get_server_status,
            system::open_folder,
            system::open_logs,
            system::select_directory,
            system::add_server_to_minecraft,
            system::add_account,
            system::switch_account,
            system::remove_account,
            system::get_screenshots,
            system::delete_screenshot,
            // Autoryzacja Microsoft
            auth_ms::login_microsoft,
            // Paczka modów
            pack_sync::sync_pack,
            pack_sync::get_latest_release_notes,
            pack_sync::get_pack_versions,
            pack_sync::get_launcher_release_notes,
            pack_sync::repair_game,
            // Modrinth + lokalne mody / shadery / resourcepacki
            modrinth::search_modrinth,
            modrinth::install_modrinth_project,
            modrinth::get_user_projects,
            modrinth::toggle_project,
            modrinth::delete_project,
            modrinth::add_local_project,
            modrinth::check_mod_updates,
            modrinth::update_mod,
            modrinth::update_all_mods,
            modrinth::get_mod_available_versions,
            // Silnik Minecraft + Fabric
            mc_launcher::launch_game,
            mc_launcher::kill_game,
            // Auto-updater
            updater::check_for_launcher_updates,
            updater::install_launcher_update,
            updater::get_launcher_version,
        ])
        .run(tauri::generate_context!())
        .expect("Błąd podczas uruchamiania aplikacji Ciapongi-RP Launcher (Tauri v2)");
}


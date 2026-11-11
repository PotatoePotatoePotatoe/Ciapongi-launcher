use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::{download_file_stream, is_newer_version, AppState};

const SERVER_BASE: &str = "https://ciapongi.szablix.pl";
const LAUNCHER_API_ENDPOINTS: [&str; 2] = [
    "https://ciapongi.szablix.pl/launcher/latest.json",
    "https://ciapongi.szablix.pl/launcher",
];
const GITHUB_OWNER: &str = "PotatoePotatoePotatoe";
const GITHUB_REPO: &str = "Ciapongi-launcher";

#[derive(Debug, Clone)]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
}

#[derive(Debug, Clone)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub body: String,
    pub assets: Vec<ReleaseAsset>,
    pub source: &'static str,
}

pub fn pick_asset(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    if cfg!(target_os = "windows") {
        let setup = assets
            .iter()
            .find(|a| a.name.contains("Setup") && a.name.ends_with(".exe"));
        let portable = assets
            .iter()
            .find(|a| !a.name.contains("Setup") && a.name.ends_with(".exe"));
        return setup.or(portable);
    }

    if cfg!(target_os = "linux") {
        let appimage = assets.iter().find(|a| a.name.ends_with(".AppImage"));
        if appimage.is_some() {
            return appimage;
        }
        return assets.iter().find(|a| a.name.ends_with(".tar.gz"));
    }

    None
}

async fn fetch_release(state: &AppState) -> Result<ReleaseInfo, String> {
    for endpoint in LAUNCHER_API_ENDPOINTS {
        state.log_to_file(&format!(
            "[Updater] Sprawdzanie aktualizacji launchera na {endpoint}..."
        ));
        match state
            .http_client
            .get(endpoint)
            .timeout(Duration::from_secs(8))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<Value>().await {
                    let raw_tag = data
                        .get("tag_name")
                        .or_else(|| data.get("version"))
                        .and_then(|v| v.as_str());
                    if let Some(tag) = raw_tag {
                        state.log_to_file(&format!(
                            "[Updater] Otrzymano dane wersji z ciapongi.szablix.pl ({tag})"
                        ));

                        let mut raw_assets: Vec<Value> = Vec::new();
                        if let Some(arr) = data.get("assets").and_then(|v| v.as_array()) {
                            raw_assets = arr.clone();
                        } else if let Some(arr) = data.get("files").and_then(|v| v.as_array()) {
                            raw_assets = arr.clone();
                        } else if let Some(filename) = data.get("filename").and_then(|v| v.as_str())
                        {
                            let url = data
                                .get("downloadUrl")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| {
                                    format!(
                                        "{SERVER_BASE}/launcher/{}",
                                        urlencoding::encode(filename)
                                    )
                                });
                            raw_assets.push(json!({
                                "name": filename,
                                "browser_download_url": url
                            }));
                        }

                        let assets: Vec<ReleaseAsset> = raw_assets
                            .into_iter()
                            .filter_map(|a| {
                                let name = a
                                    .get("name")
                                    .or_else(|| a.get("filename"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let mut asset_url = a
                                    .get("browser_download_url")
                                    .or_else(|| a.get("url"))
                                    .or_else(|| a.get("download_url"))
                                    .and_then(|v| v.as_str())?
                                    .to_string();

                                if !asset_url.starts_with("http") {
                                    let slash = if asset_url.starts_with('/') { "" } else { "/" };
                                    asset_url = format!("{SERVER_BASE}{slash}{asset_url}");
                                }
                                Some(ReleaseAsset {
                                    name,
                                    download_url: asset_url,
                                })
                            })
                            .collect();

                        let tag_name = if tag.starts_with('v') {
                            tag.to_string()
                        } else {
                            format!("v{tag}")
                        };
                        let body = data
                            .get("body")
                            .or_else(|| data.get("releaseNotes"))
                            .or_else(|| data.get("changelog"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Nowa aktualizacja launchera na ciapongi.szablix.pl")
                            .to_string();

                        return Ok(ReleaseInfo {
                            tag_name,
                            body,
                            assets,
                            source: "ciapongi.szablix.pl",
                        });
                    }
                }
            }
            Ok(resp) => {
                state.log_to_file(&format!(
                    "[Updater] Endpoint {endpoint} niedostępny (HTTP {}).",
                    resp.status().as_u16()
                ));
            }
            Err(e) => {
                state.log_to_file(&format!(
                    "[Updater] Endpoint {endpoint} niedostępny ({e})."
                ));
            }
        }
    }

    // Rezerwowy fallback: GitHub Releases API
    state.log_to_file("[Updater] Sprawdzanie rezerwowego źródła na GitHub Releases...");
    let gh_url = format!(
        "https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    );
    let resp = state
        .http_client
        .get(&gh_url)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("Błąd połączenia z GitHub Releases: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let gh_data = resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Błąd parsowania JSON z GitHub Releases: {e}"))?;

    let tag_name = gh_data
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak tag_name w GitHub Release.".to_string())?
        .to_string();
    let body = gh_data
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let assets = gh_data
        .get("assets")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    Some(ReleaseAsset {
                        name: a.get("name")?.as_str()?.to_string(),
                        download_url: a.get("browser_download_url")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ReleaseInfo {
        tag_name,
        body,
        assets,
        source: "github",
    })
}

fn send_update_event(app: &AppHandle, payload: Value) {
    let _ = app.emit("launcher-update-event", payload);
}

pub async fn run_update_check(
    app: &AppHandle,
    state: &AppState,
    auto_download: bool,
    enforce_packaged: bool,
) -> Result<(), String> {
    if enforce_packaged && !state.is_packaged {
        state.log_to_file("[Updater] Dev mode — auto-updater disabled.");
        return Ok(());
    }

    send_update_event(app, json!({ "status": "checking" }));
    state.log_to_file("[Updater] Sprawdzanie aktualizacji launchera (ciapongi.szablix.pl / GitHub)...");

    let release = match fetch_release(state).await {
        Ok(r) => r,
        Err(err) => {
            state.log_to_file(&format!("[Updater] Błąd pobierania danych o wersji: {err}"));
            send_update_event(
                app,
                json!({ "status": "error", "error": format!("Nie udało się sprawdzić aktualizacji: {err}") }),
            );
            return Err(err);
        }
    };

    let local_version = app.package_info().version.to_string();
    state.log_to_file(&format!(
        "[Updater] Wersja zdalna: {} | Lokalna: v{local_version} (źródło: {})",
        release.tag_name, release.source
    ));

    if !is_newer_version(&release.tag_name, &local_version) {
        state.log_to_file("[Updater] Brak nowszej wersji. Launcher jest aktualny.");
        send_update_event(
            app,
            json!({ "status": "not-available", "info": { "version": local_version } }),
        );
        return Ok(());
    }

    let Some(asset) = pick_asset(&release.assets).cloned() else {
        state.log_to_file("[Updater] Brak pasującego pliku instalacyjnego dla tej platformy.");
        send_update_event(
            app,
            json!({ "status": "error", "error": "Brak kompatybilnego pliku aktualizacji dla tego systemu." }),
        );
        return Err("Brak kompatybilnego pliku aktualizacji dla tego systemu.".to_string());
    };

    let clean_remote = release.tag_name.trim_start_matches('v').to_string();
    state.log_to_file(&format!(
        "[Updater] Dostępna aktualizacja: {} (plik: {})",
        release.tag_name, asset.name
    ));

    send_update_event(
        app,
        json!({
            "status": "available",
            "info": {
                "version": clean_remote,
                "assetName": asset.name,
                "releaseNotes": release.body
            }
        }),
    );

    if auto_download {
        let dest_path = std::env::temp_dir().join(&asset.name);
        state.log_to_file(&format!(
            "[Updater] Pobieranie aktualizacji: {} z {}",
            asset.name, asset.download_url
        ));

        let app_clone = app.clone();
        match download_file_stream(
            &state.download_client,
            &asset.download_url,
            &dest_path,
            Some(move |info: crate::state::DownloadProgressInfo| {
                send_update_event(
                    &app_clone,
                    json!({ "status": "downloading", "progress": info.progress }),
                );
            }),
        )
        .await
        {
            Ok(()) => {
                if let Ok(mut pending) = state.pending_update_path.lock() {
                    *pending = Some(dest_path.clone());
                }
                state.log_to_file(&format!(
                    "[Updater] Pobieranie zakończone: {}",
                    dest_path.display()
                ));
                send_update_event(
                    app,
                    json!({
                        "status": "downloaded",
                        "filePath": dest_path.to_string_lossy(),
                        "assetName": asset.name
                    }),
                );

                let is_appimage_ctx = cfg!(target_os = "linux")
                    && (std::env::var("APPIMAGE").is_ok() || asset.name.ends_with(".AppImage"));
                if is_appimage_ctx {
                    if !state.is_game_running() {
                        state.log_to_file("[Updater] Auto-update Linux: aktualizacja pobrana, automatyczna instalacja i restart...");
                        send_update_event(
                            app,
                            json!({ "status": "installing", "version": clean_remote }),
                        );
                        let app_handle = app.clone();
                        let file_to_install = dest_path.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(800)).await;
                            let state = app_handle.state::<AppState>();
                            install_update_file(&app_handle, &state, &file_to_install);
                        });
                    } else {
                        state.log_to_file("[Updater] Gra jest uruchomiona — instalacja aktualizacji odłożona do jej zamknięcia.");
                    }
                }
            }
            Err(e) => {
                state.log_to_file(&format!("[Updater] Błąd pobierania: {e}"));
                send_update_event(
                    app,
                    json!({ "status": "error", "error": format!("Błąd pobierania: {e}") }),
                );
                return Err(e);
            }
        }
    }

    Ok(())
}

fn show_file_in_folder(file: &Path) {
    let target = file.parent().unwrap_or(file);
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("explorer")
            .arg(format!("/select,{}", file.display()))
            .spawn();
        let _ = target;
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(target).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").args(["-R"]).arg(file).spawn();
    }
}

pub fn install_update_file(app: &AppHandle, state: &AppState, file: &Path) {
    state.log_to_file(&format!(
        "[Updater] Instalowanie aktualizacji: {}",
        file.display()
    ));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", ""])
            .arg(file)
            .creation_flags(CREATE_NO_WINDOW);
        match cmd.spawn()
        {
            Ok(_) => {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    app_clone.exit(0);
                });
            }
            Err(e) => {
                state.log_to_file(&format!("[Updater] Błąd uruchamiania instalatora: {e}"));
                show_file_in_folder(file);
            }
        }
        return;
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;

        let file_is_appimage = file
            .file_name()
            .and_then(|s| s.to_str())
            .map(|n| n.ends_with(".AppImage"))
            .unwrap_or(false);

        if std::env::var("APPIMAGE").is_ok() || file_is_appimage {
            let mut current_appimage = std::env::var("APPIMAGE")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from);

            if current_appimage.is_none() {
                if let Ok(argv0) = std::env::var("ARGV0") {
                    if argv0.ends_with(".AppImage") && Path::new(&argv0).exists() {
                        current_appimage = Some(PathBuf::from(argv0));
                    }
                }
            }

            let Some(mut target_appimage) = current_appimage.filter(|p| p.exists()) else {
                state.log_to_file(&format!(
                    "[Updater] Brak ścieżki do obecnego pliku AppImage, otwieram pobrany plik w folderze: {}",
                    file.display()
                ));
                show_file_in_folder(file);
                return;
            };

            if let Ok(canon) = fs::canonicalize(&target_appimage) {
                target_appimage = canon;
            }

            state.log_to_file(&format!(
                "[Updater] Bezpieczna podmiana AppImage: {} z pobranego {}",
                target_appimage.display(),
                file.display()
            ));

            let target_dir = target_appimage
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            let base_name = target_appimage
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("launcher.AppImage");
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let target_temp = target_dir.join(format!(".{base_name}.update-{ts}"));

            if let Err(e) = fs::copy(file, &target_temp) {
                state.log_to_file(&format!("[Updater] Błąd kopiowania AppImage: {e}"));
                show_file_in_folder(file);
                return;
            }
            let _ = fs::set_permissions(&target_temp, fs::Permissions::from_mode(0o755));

            if let Err(e) = fs::remove_file(&target_appimage) {
                state.log_to_file(&format!(
                    "[Updater] Informacja remove starego AppImage: {e}"
                ));
            }
            if let Err(e) = fs::rename(&target_temp, &target_appimage) {
                state.log_to_file(&format!("[Updater] Błąd podmiany AppImage: {e}"));
                show_file_in_folder(file);
                return;
            }
            let _ = fs::set_permissions(&target_appimage, fs::Permissions::from_mode(0o755));

            if file != target_appimage && file.exists() {
                let _ = fs::remove_file(file);
            }

            state.log_to_file(
                "[Updater] Plik AppImage został pomyślnie podmieniony! Restartowanie launchera...",
            );

            let extra_args: Vec<String> = std::env::args().skip(1).collect();
            let _ = Command::new(&target_appimage)
                .args(extra_args)
                .env_remove("APPDIR")
                .env_remove("OWD")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();

            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                app_clone.exit(0);
            });
            return;
        }
    }

    show_file_in_folder(file);
}

#[tauri::command]
pub fn get_launcher_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn check_for_launcher_updates(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let auto_download = cfg.auto_update_launcher;

    // Przy ręcznym wywołaniu sprawdzamy także w dev mode (a semver 2.0.0 chroni przed downgrade).
    match run_update_check(&app, &state, auto_download, false).await {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => {
            state.log_to_file(&format!("[GithubUpdater] Manual check error: {e}"));
            Ok(json!({ "success": false, "error": e }))
        }
    }
}

#[tauri::command]
pub async fn install_launcher_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let pending = state
        .pending_update_path
        .lock()
        .ok()
        .and_then(|g| g.clone());

    let Some(file_path) = pending else {
        state.log_to_file("[Updater] Wywołano instalację, ale brak pobranego pliku.");
        return Ok(json!({ "success": false, "error": "Brak pobranego pliku aktualizacji." }));
    };

    install_update_file(&app, &state, &file_path);
    Ok(json!({ "success": true }))
}


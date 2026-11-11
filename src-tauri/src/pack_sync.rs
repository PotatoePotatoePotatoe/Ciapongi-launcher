use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use zip::ZipArchive;

use crate::state::{download_file_stream, emit_status, is_newer_version, AppState};

const PACZKI_API: &str = "https://ciapongi.szablix.pl/paczki";
const PACK_CHECK_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Serialize)]
pub struct PackVersionItem {
    pub tag_name: String,
    pub name: String,
    pub published_at: Value,
    pub filename: String,
    pub size: u64,
}

fn is_pack_fully_installed(game_dir: &Path) -> bool {
    game_dir.join("pack-manifest.json").exists() && game_dir.join("mods").exists()
}

fn find_pack_root(dir: &Path) -> Option<PathBuf> {
    let entries: Vec<(String, PathBuf, bool)> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| {
            let p = e.path();
            let is_dir = p.is_dir();
            let name = e.file_name().to_string_lossy().to_string();
            (name, p, is_dir)
        })
        .collect();

    if entries
        .iter()
        .any(|(n, _, _)| n == "mods" || n == "config" || n == "launcher-config.json")
    {
        return Some(dir.to_path_buf());
    }

    for (_, p, is_dir) in entries {
        if is_dir {
            if let Some(sub) = find_pack_root(&p) {
                return Some(sub);
            }
        }
    }
    None
}

fn copy_dir_recursive(
    src: &Path,
    dest: &Path,
    base_dest: &Path,
    relative_list: &mut Vec<String>,
) -> Result<(), String> {
    fs::create_dir_all(dest)
        .map_err(|e| format!("Błąd tworzenia katalogu {}: {e}", dest.display()))?;

    let entries = fs::read_dir(src)
        .map_err(|e| format!("Błąd odczytu katalogu {}: {e}", src.display()))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let src_path = entry.path();
        let dest_path = dest.join(&name);

        if src_path.is_dir() {
            let lower = name.to_ascii_lowercase();
            if lower == "saves" || lower == "screenshots" || lower == "logs" {
                continue;
            }
            copy_dir_recursive(&src_path, &dest_path, base_dest, relative_list)?;
        } else {
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Błąd kopiowania {}: {e}", dest_path.display()))?;
            if let Ok(rel) = dest_path.strip_prefix(base_dest) {
                relative_list.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }

    Ok(())
}

fn collect_disabled_filenames(dir: &Path, out: &mut HashSet<String>) {
    if !dir.exists() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.len() >= 9 && name[name.len() - 9..].eq_ignore_ascii_case(".disabled") {
                out.insert(name[..name.len() - 9].to_string());
            }
        }
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn get_pack_versions(state: State<'_, AppState>) -> Result<Vec<PackVersionItem>, String> {
    let Ok(resp) = state.http_client.get(PACZKI_API).send().await else {
        return Ok(Vec::new());
    };
    if !resp.status().is_success() {
        return Ok(Vec::new());
    }
    let Ok(arr) = resp.json::<Vec<Value>>().await else {
        return Ok(Vec::new());
    };

    Ok(arr
        .into_iter()
        .filter_map(|p| {
            let version = p.get("version")?.as_str()?.to_string();
            let filename = p.get("filename")?.as_str()?.to_string();
            let size = p.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
            let published_at = p.get("createdAt").cloned().unwrap_or(Value::Null);
            Some(PackVersionItem {
                name: format!("CiapongiRP {version}"),
                tag_name: version,
                published_at,
                filename,
                size,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn get_latest_release_notes(
    state: State<'_, AppState>,
) -> Result<Option<Value>, String> {
    let Ok(resp) = state.http_client.get(PACZKI_API).send().await else {
        return Ok(None);
    };
    if !resp.status().is_success() {
        return Ok(None);
    }
    let Ok(arr) = resp.json::<Vec<Value>>().await else {
        return Ok(None);
    };
    let Some(latest) = arr.first() else {
        return Ok(None);
    };
    let Some(version) = latest.get("version").and_then(|v| v.as_str()) else {
        return Ok(None);
    };
    let size = latest.get("size").and_then(|v| v.as_u64());
    let size_str = size
        .filter(|&s| s > 0)
        .map(|s| format!("{:.1} MB", s as f64 / 1_048_576.0))
        .unwrap_or_else(|| "Nieznany rozmiar".to_string());

    Ok(Some(json!({
        "tag_name": version,
        "name": format!("CiapongiRP {version}"),
        "body": format!("Paczka CiapongiRP w wersji {version} ({size_str}).\n\nPobierz najnowszą wersję przez launcher lub ze strony ciapongi.szablix.pl"),
        "published_at": latest.get("createdAt").cloned().unwrap_or(Value::Null)
    })))
}

#[tauri::command]
pub async fn get_launcher_release_notes(
    state: State<'_, AppState>,
) -> Result<Option<Value>, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };

    let raw_url =
        "https://raw.githubusercontent.com/PotatoePotatoePotatoe/Ciapongi-launcher/main/CHANGELOG.md";

    let mut req = state.http_client.get(raw_url);
    if !cfg.github_token.trim().is_empty() {
        req = req.header("Authorization", format!("token {}", cfg.github_token.trim()));
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(text) = resp.text().await {
                if !text.is_empty() {
                    return Ok(Some(json!({
                        "type": "full_changelog",
                        "content": text
                    })));
                }
            }
        }
        Ok(resp) => {
            state.log_to_file(&format!(
                "Nie udalo sie pobrac CHANGELOG.md: HTTP {}",
                resp.status().as_u16()
            ));
        }
        Err(e) => {
            state.log_to_file(&format!("Nie udalo sie pobrac CHANGELOG.md: {e}"));
        }
    }

    // Fallback: GitHub Releases API
    let api_url =
        "https://api.github.com/repos/PotatoePotatoePotatoe/Ciapongi-launcher/releases?per_page=10";
    let mut fallback_req = state.http_client.get(api_url);
    if !cfg.github_token.trim().is_empty() {
        fallback_req =
            fallback_req.header("Authorization", format!("token {}", cfg.github_token.trim()));
    }

    match fallback_req.send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(releases) = resp.json::<Vec<Value>>().await {
                if !releases.is_empty() {
                    let combined = releases
                        .iter()
                        .map(|r| {
                            let title = r
                                .get("name")
                                .or_else(|| r.get("tag_name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("Wydanie");
                            let body = r.get("body").and_then(|v| v.as_str()).unwrap_or("");
                            format!("## {title}\n{body}").trim().to_string()
                        })
                        .collect::<Vec<_>>()
                        .join("\n\n---\n\n");

                    return Ok(Some(json!({
                        "type": "full_changelog",
                        "content": combined
                    })));
                }
            }
        }
        Err(e) => {
            state.log_to_file(&format!("Fallback releases API rowniez nieudany: {e}"));
        }
        _ => {}
    }

    Ok(None)
}

#[tauri::command]
pub async fn sync_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    force: bool,
) -> Result<Value, String> {
    let mut cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };

    let game_dir = PathBuf::from(&cfg.game_dir);
    let manifest_path = game_dir.join("pack-manifest.json");

    if cfg.disable_auto_update && !force {
        if is_pack_fully_installed(&game_dir) {
            emit_status(&app, "Automatyczne aktualizacje paczki są wyłączone.");
            let _ = app.emit(
                "pack-sync-progress",
                json!({ "status": "idle", "progress": 100 }),
            );
            return Ok(json!({ "success": true }));
        } else {
            emit_status(
                &app,
                "Brak plików paczki modów na dysku. Wymuszanie pierwszeństwa pobrania pierwszej instalacji...",
            );
            state.log_to_file("[SYSTEM] Opcja disableAutoUpdate jest włączona, ale paczka nie istnieje na dysku. Pobieranie pierwszej instalacji...");
        }
    }

    // Sprawdzenie cache 24h
    if !force && is_pack_fully_installed(&game_dir) {
        let last_check = cfg.last_pack_github_check.unwrap_or(0);
        let now = now_epoch_ms();
        let elapsed = now.saturating_sub(last_check);
        if elapsed < PACK_CHECK_INTERVAL_MS {
            let hours_left = ((PACK_CHECK_INTERVAL_MS - elapsed) as f64 / 3_600_000.0).round();
            state.log_to_file(&format!(
                "[SYSTEM] Cache 24h aktywny — pomijam sprawdzanie serwera paczek (odświeżenie za ~{hours_left}h)."
            ));
            let ver_label = if cfg.pack_version.is_empty() {
                "aktualna"
            } else {
                cfg.pack_version.as_str()
            };
            emit_status(&app, format!("Paczka jest gotowa (wersja {ver_label})"));
            let _ = app.emit(
                "pack-sync-progress",
                json!({ "status": "idle", "progress": 100 }),
            );
            return Ok(json!({ "success": true, "updated": false }));
        }
    }

    let temp_dir = game_dir.join("temp");
    let res = sync_pack_inner(&app, &state, &mut cfg, &game_dir, &manifest_path, &temp_dir, force).await;

    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }

    match res {
        Ok(updated) => Ok(json!({ "success": true, "updated": updated })),
        Err(err) => {
            emit_status(&app, format!("Błąd: {err}"));
            let _ = app.emit(
                "pack-sync-progress",
                json!({ "status": "error", "error": err }),
            );
            Ok(json!({ "success": false, "error": err }))
        }
    }
}

async fn sync_pack_inner(
    app: &AppHandle,
    state: &AppState,
    cfg: &mut crate::state::LauncherConfig,
    game_dir: &Path,
    manifest_path: &Path,
    temp_dir: &Path,
    force: bool,
) -> Result<bool, String> {
    emit_status(app, "Sprawdzanie wersji paczki na ciapongi.szablix.pl...");
    fs::create_dir_all(game_dir).map_err(|e| format!("Błąd tworzenia katalogu gry: {e}"))?;
    fs::create_dir_all(temp_dir).map_err(|e| format!("Błąd tworzenia temp: {e}"))?;

    let resp = state
        .http_client
        .get(PACZKI_API)
        .send()
        .await
        .map_err(|e| format!("Brak połączenia z serwerem paczek ({e})"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Brak połączenia z serwerem paczek (HTTP {})",
            resp.status().as_u16()
        ));
    }
    let pack_list = resp
        .json::<Vec<Value>>()
        .await
        .map_err(|e| format!("Brak połączenia z serwerem paczek ({e})"))?;

    if pack_list.is_empty() {
        return Err("Brak dostępnych paczek na serwerze.".to_string());
    }

    let target_pack = if let Some(ref target_ver) = cfg.target_pack_version {
        if !target_ver.is_empty() && target_ver != "latest" {
            if let Some(found) = pack_list
                .iter()
                .find(|p| p.get("version").and_then(|v| v.as_str()) == Some(target_ver.as_str()))
            {
                found
            } else {
                emit_status(
                    app,
                    format!("Nie znaleziono wersji {target_ver}, pobieranie najnowszej..."),
                );
                &pack_list[0]
            }
        } else {
            &pack_list[0]
        }
    } else {
        &pack_list[0]
    };

    let latest_version = target_pack
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak pola version na serwerze paczek.".to_string())?
        .to_string();
    let filename = target_pack
        .get("filename")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak pola filename na serwerze paczek.".to_string())?
        .to_string();

    let is_installed = is_pack_fully_installed(game_dir);

    if !force && cfg.pack_version == latest_version && is_installed {
        cfg.last_pack_github_check = Some(now_epoch_ms());
        {
            let _g = state.config_lock.lock().await;
            state.write_config(cfg)?;
        }
        emit_status(app, format!("Paczka jest gotowa (wersja {latest_version})"));
        let _ = app.emit(
            "pack-sync-progress",
            json!({ "status": "idle", "progress": 100 }),
        );
        return Ok(false);
    }

    if !force && cfg.pack_version == latest_version && !is_installed {
        emit_status(
            app,
            "Coś poszło nie tak z plikami paczki. Launcher naprawia i pobiera brakujące mody...",
        );
        state.log_to_file("[SYSTEM] Wykryto brakujące lub uszkodzone pliki paczki przy zgodnej wersji. Uruchamianie naprawy...");
    } else {
        emit_status(
            app,
            format!("Wykryto nową wersję na serwerze: CiapongiRP {latest_version}. Przygotowywanie aktualizacji..."),
        );
    }

    let download_url = format!("{PACZKI_API}/{}", urlencoding::encode(&filename));
    emit_status(app, format!("Pobieranie paczki CiapongiRP {latest_version}..."));

    // Zachowanie wyłączonych (.disabled) plików paczki
    let mut disabled_pack_files: HashSet<String> = HashSet::new();
    collect_disabled_filenames(&game_dir.join("mods"), &mut disabled_pack_files);
    collect_disabled_filenames(&game_dir.join("resourcepacks"), &mut disabled_pack_files);

    // Czyszczenie poprzednich plików z pack-manifest.json
    if manifest_path.exists() {
        if let Ok(raw) = fs::read_to_string(manifest_path) {
            if let Ok(old_files) = serde_json::from_str::<Vec<String>>(&raw) {
                for rel in old_files {
                    let full = game_dir.join(&rel);
                    if full.exists() {
                        let _ = fs::remove_file(&full);
                    }
                    let full_dis = game_dir.join(format!("{rel}.disabled"));
                    if full_dis.exists() {
                        let _ = fs::remove_file(&full_dis);
                    }
                }
            }
        }
    }

    emit_status(
        app,
        format!("Pobieranie paczki modyfikacji CiapongiRP {latest_version}..."),
    );
    let _ = app.emit(
        "pack-sync-progress",
        json!({ "status": "downloading", "progress": 0 }),
    );

    let zip_path = temp_dir.join("pack.zip");
    let app_clone = app.clone();
    download_file_stream(
        &state.download_client,
        &download_url,
        &zip_path,
        Some(move |info: crate::state::DownloadProgressInfo| {
            let _ = app_clone.emit(
                "pack-sync-progress",
                json!({
                    "status": "downloading",
                    "progress": info.progress,
                    "transferred": info.transferred,
                    "total": info.total,
                    "speed": info.speed
                }),
            );
        }),
    )
    .await?;

    emit_status(app, "Wypakowywanie plików...");
    let _ = app.emit(
        "pack-sync-progress",
        json!({ "status": "extracting", "progress": 50 }),
    );

    let extract_path = temp_dir.join("extracted");
    if extract_path.exists() {
        let _ = fs::remove_dir_all(&extract_path);
    }
    fs::create_dir_all(&extract_path).map_err(|e| format!("Błąd tworzenia folderu extract: {e}"))?;

    let game_dir_clone = game_dir.to_path_buf();
    let extract_clone = extract_path.clone();
    let zip_clone = zip_path.clone();

    let (copied_files, inner_cfg_opt) = tokio::task::spawn_blocking(move || -> Result<(Vec<String>, Option<Value>), String> {
        let file = File::open(&zip_clone).map_err(|e| format!("Nie można otworzyć ZIP: {e}"))?;
        let mut archive = ZipArchive::new(file).map_err(|e| format!("Nieprawidłowe archiwum ZIP: {e}"))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| format!("Błąd odczytu wpisu ZIP: {e}"))?;
            let Some(enclosed) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
                continue;
            };
            let out_path = extract_clone.join(enclosed);
            if entry.is_dir() {
                fs::create_dir_all(&out_path).map_err(|e| format!("Błąd mkdir: {e}"))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("Błąd mkdir: {e}"))?;
                }
                let mut outfile = File::create(&out_path).map_err(|e| format!("Błąd tworzenia pliku: {e}"))?;
                io::copy(&mut entry, &mut outfile).map_err(|e| format!("Błąd wypakowywania pliku: {e}"))?;
            }
        }

        let pack_root = find_pack_root(&extract_clone).ok_or_else(|| {
            "W archiwum ZIP nie odnaleziono katalogu z modami (mods) ani konfiguracją (config).".to_string()
        })?;

        let inner_config_path = pack_root.join("launcher-config.json");
        let inner_cfg = if inner_config_path.exists() {
            fs::read_to_string(&inner_config_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        } else {
            None
        };

        let mut copied = Vec::new();
        copy_dir_recursive(&pack_root, &game_dir_clone, &game_dir_clone, &mut copied)?;

        if !disabled_pack_files.is_empty() {
            for rel in &copied {
                let full_path = game_dir_clone.join(rel);
                if let Some(base_name) = full_path.file_name().and_then(|s| s.to_str()) {
                    if disabled_pack_files.contains(base_name) && full_path.exists() {
                        let dis_path = PathBuf::from(format!("{}.disabled", full_path.display()));
                        if dis_path.exists() {
                            let _ = fs::remove_file(&dis_path);
                        }
                        let _ = fs::rename(&full_path, &dis_path);
                    }
                }
            }
        }

        Ok((copied, inner_cfg))
    })
    .await
    .map_err(|e| format!("Błąd zadania wypakowania: {e}"))??;

    if let Some(inner_cfg) = inner_cfg_opt {
        if let Some(mc) = inner_cfg.get("minecraftVersion").and_then(|v| v.as_str()) {
            if !mc.is_empty() {
                cfg.minecraft_version = mc.to_string();
            }
        }
        if let Some(loader) = inner_cfg.get("loader").and_then(|v| v.as_str()) {
            if !loader.is_empty() {
                cfg.loader = loader.to_string();
            }
        }
        if let Some(lv) = inner_cfg.get("loaderVersion").and_then(|v| v.as_str()) {
            if !lv.is_empty() && lv != "latest" {
                if cfg.loader_version.is_empty() || is_newer_version(lv, &cfg.loader_version) {
                    cfg.loader_version = lv.to_string();
                }
            }
        }
    }

    let manifest_json = serde_json::to_string_pretty(&copied_files)
        .map_err(|e| format!("Błąd serializacji pack-manifest.json: {e}"))?;
    fs::write(manifest_path, manifest_json)
        .map_err(|e| format!("Błąd zapisu pack-manifest.json: {e}"))?;

    state.mod_cache.invalidate_pack_cache();

    cfg.pack_version = latest_version;
    cfg.last_pack_github_check = Some(now_epoch_ms());
    {
        let _g = state.config_lock.lock().await;
        state.write_config(cfg)?;
    }

    emit_status(app, "Wszystko gotowe! Paczka zaktualizowana.");
    let _ = app.emit(
        "pack-sync-progress",
        json!({ "status": "idle", "progress": 100 }),
    );
    Ok(true)
}

#[tauri::command]
pub async fn repair_game(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.config_lock.lock().await;
    let mut cfg = state.read_config();
    let game_dir = PathBuf::from(&cfg.game_dir);

    let manifest_path = game_dir.join("pack-manifest.json");
    if manifest_path.exists() {
        if let Err(e) = fs::remove_file(&manifest_path) {
            return Ok(json!({ "success": false, "error": e.to_string() }));
        }
        state.log_to_file("[REPAIR] Usunięto pack-manifest.json");
    }

    state.mod_cache.invalidate_pack_cache();
    cfg.pack_version = String::new();
    cfg.last_pack_github_check = Some(0);

    if let Err(e) = state.write_config(&cfg) {
        return Ok(json!({ "success": false, "error": e }));
    }
    state.log_to_file("[REPAIR] Zresetowano packVersion i lastPackGithubCheck w configu");
    Ok(json!({ "success": true }))
}


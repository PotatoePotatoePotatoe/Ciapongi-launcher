use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use futures_util::stream::{self, StreamExt};
use rayon::prelude::*;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader as AsyncBufReader};
use tokio::process::Command as AsyncCommand;
use tokio::sync::{oneshot, Semaphore};
use zip::ZipArchive;

use crate::auth_ms::refresh_minecraft_token_if_needed;
use crate::modrinth::clean_duplicate_mods;
use crate::state::{
    download_file_stream, emit_status, get_total_ram_mb, ActiveGame, AppState, LauncherConfig,
};
use crate::updater;

const MOJANG_MANIFEST_V2: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const MOJANG_RESOURCES_BASE: &str = "https://resources.download.minecraft.net";
const MOJANG_LIBRARIES_BASE: &str = "https://libraries.minecraft.net/";

#[derive(Debug, Clone)]
pub struct MavenArtifact {
    pub rel_path: String,
    pub group: String,
    pub artifact: String,
    pub classifier: String,
}

#[derive(Debug, Clone)]
struct DownloadTask {
    url: String,
    dest: PathBuf,
    expected_sha1: Option<String>,
    expected_size: Option<u64>,
}

#[derive(Debug, Clone)]
struct ResolvedAuth {
    access_token: String,
    client_token: String,
    uuid: String,
    name: String,
    user_type: String,
    xuid: String,
    user_properties: String,
    is_demo: bool,
}

pub async fn get_latest_fabric_loader(
    client: &reqwest::Client,
    mc_version: &str,
) -> Option<String> {
    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{mc_version}");
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let list = resp.json::<Vec<Value>>().await.ok()?;
    for item in list {
        let Some(loader) = item.get("loader") else {
            continue;
        };
        if loader.get("stable").and_then(|v| v.as_bool()) == Some(true) {
            if let Some(ver) = loader.get("version").and_then(|v| v.as_str()) {
                return Some(ver.to_string());
            }
        }
    }
    None
}

pub fn determine_required_java_version(java_version_cfg: &str, mc_ver: &str) -> u32 {
    let trimmed = java_version_cfg.trim();
    if !trimmed.is_empty() && trimmed != "auto" {
        if let Ok(parsed) = trimmed.parse::<u32>() {
            return parsed;
        }
    }

    if mc_ver.starts_with("1.20.5")
        || mc_ver.starts_with("1.20.6")
        || mc_ver.starts_with("1.21")
        || mc_ver.starts_with("1.22")
    {
        21
    } else if mc_ver.starts_with("1.16")
        || mc_ver.starts_with("1.15")
        || mc_ver.starts_with("1.12")
        || mc_ver.starts_with("1.8")
        || mc_ver.starts_with("1.7")
    {
        8
    } else {
        17
    }
}

pub fn find_java_executable(dir: &Path) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let exe_name = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };

    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "bin" {
                let candidate = path.join(exe_name);
                if candidate.exists() && candidate.is_file() {
                    return Some(candidate);
                }
            }
            if let Some(found) = find_java_executable(&path) {
                return Some(found);
            }
        }
    }
    None
}

async fn ensure_java_runtime(
    app: &AppHandle,
    state: &AppState,
    game_dir: &Path,
    cfg: &LauncherConfig,
    required_java: u32,
) -> Result<String, String> {
    let custom_java = cfg.java_path.trim();
    if !custom_java.is_empty() {
        let p = Path::new(custom_java);
        if !p.exists() {
            return Err(format!(
                "Podana ścieżka Java nie istnieje: {}",
                p.display()
            ));
        }
        return Ok(custom_java.to_string());
    }

    let java_dir = game_dir.join(format!("java-runtime-{required_java}"));
    if let Some(exec_path) = find_java_executable(&java_dir) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&exec_path, fs::Permissions::from_mode(0o755));
        }
        return Ok(exec_path.to_string_lossy().to_string());
    }

    emit_status(
        app,
        format!("Przygotowywanie środowiska Java {required_java}..."),
    );
    let _ = app.emit(
        "launch-progress",
        json!({ "status": "java_download", "progress": 0 }),
    );

    let os_slug = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch_slug = match std::env::consts::ARCH {
        "x86" => "x32",
        "aarch64" => "aarch64",
        _ => "x64",
    };

    let java_url = format!(
        "https://api.adoptium.net/v3/binary/latest/{required_java}/ga/{os_slug}/{arch_slug}/jdk/hotspot/normal/eclipse"
    );
    let archive_name = if cfg!(target_os = "windows") {
        "java.zip"
    } else {
        "java.tar.gz"
    };
    let java_temp_file = game_dir.join(archive_name);

    let app_clone = app.clone();
    download_file_stream(
        &state.download_client,
        &java_url,
        &java_temp_file,
        Some(move |info: crate::state::DownloadProgressInfo| {
            let _ = app_clone.emit(
                "launch-progress",
                json!({
                    "status": "java_download",
                    "progress": info.progress,
                    "transferred": info.transferred,
                    "total": info.total,
                    "speed": info.speed
                }),
            );
        }),
    )
    .await?;

    emit_status(app, "Instalowanie wymaganej wersji Javy...");
    let _ = app.emit(
        "launch-progress",
        json!({ "status": "java_extract", "progress": 50 }),
    );

    let java_dir_clone = java_dir.clone();
    let archive_clone = java_temp_file.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        if java_dir_clone.exists() {
            let _ = fs::remove_dir_all(&java_dir_clone);
        }
        fs::create_dir_all(&java_dir_clone)
            .map_err(|e| format!("Błąd tworzenia katalogu Javy: {e}"))?;

        if cfg!(target_os = "windows") {
            let file = File::open(&archive_clone)
                .map_err(|e| format!("Błąd otwarcia archiwum ZIP Javy: {e}"))?;
            let mut archive = ZipArchive::new(file)
                .map_err(|e| format!("Nieprawidłowe archiwum ZIP Javy: {e}"))?;
            for i in 0..archive.len() {
                let mut entry = archive
                    .by_index(i)
                    .map_err(|e| format!("Błąd wpisu ZIP Javy: {e}"))?;
                let Some(enclosed) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
                    continue;
                };
                let out_path = java_dir_clone.join(enclosed);
                if entry.is_dir() {
                    fs::create_dir_all(&out_path)
                        .map_err(|e| format!("Błąd mkdir Java: {e}"))?;
                } else {
                    if let Some(parent) = out_path.parent() {
                        fs::create_dir_all(parent)
                            .map_err(|e| format!("Błąd mkdir Java: {e}"))?;
                    }
                    let mut out = File::create(&out_path)
                        .map_err(|e| format!("Błąd tworzenia pliku Javy: {e}"))?;
                    io::copy(&mut entry, &mut out)
                        .map_err(|e| format!("Błąd wypakowania Javy: {e}"))?;
                }
            }
        } else {
            let file = File::open(&archive_clone)
                .map_err(|e| format!("Błąd otwarcia tar.gz Javy: {e}"))?;
            let gz = GzDecoder::new(BufReader::new(file));
            let mut archive = Archive::new(gz);
            archive
                .unpack(&java_dir_clone)
                .map_err(|e| format!("Błąd rozpakowywania Java tar.gz: {e}"))?;
        }

        let _ = fs::remove_file(&archive_clone);
        Ok(())
    })
    .await
    .map_err(|e| format!("Błąd wątku rozpakowywania Javy: {e}"))??;

    let final_exec = find_java_executable(&java_dir).ok_or_else(|| {
        format!(
            "Pobrane środowisko Java {required_java} jest nieprawidłowe. Brak pliku wykonywalnego java."
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(bin_dir) = final_exec.parent() {
            if let Ok(entries) = fs::read_dir(bin_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o755));
                    }
                }
            }
        }
        let _ = fs::set_permissions(&final_exec, fs::Permissions::from_mode(0o755));
    }

    Ok(final_exec.to_string_lossy().to_string())
}

pub fn parse_maven_coord(coord: &str) -> Option<MavenArtifact> {
    let (main_part, ext) = match coord.split_once('@') {
        Some((m, e)) => (m, e),
        None => (coord, "jar"),
    };
    let parts: Vec<&str> = main_part.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0];
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).copied().unwrap_or("");

    let group_path = group.replace('.', "/");
    let filename = if classifier.is_empty() {
        format!("{artifact}-{version}.{ext}")
    } else {
        format!("{artifact}-{version}-{classifier}.{ext}")
    };
    let rel_path = format!("{group_path}/{artifact}/{version}/{filename}");

    Some(MavenArtifact {
        rel_path,
        group: group.to_string(),
        artifact: artifact.to_string(),
        classifier: classifier.to_string(),
    })
}

fn current_mojang_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn current_mojang_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86" => "x86",
        "aarch64" => "arm64",
        _ => "x86_64",
    }
}

pub fn eval_rules_for(
    rules_val: Option<&Value>,
    os_name: &str,
    arch_name: &str,
    features: &HashSet<&str>,
) -> bool {
    let Some(rules_arr) = rules_val.and_then(|v| v.as_array()) else {
        return true;
    };
    if rules_arr.is_empty() {
        return true;
    }

    let mut allowed = false;
    for rule in rules_arr {
        let action = rule
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("allow");

        let mut matches = true;

        if let Some(os_obj) = rule.get("os") {
            if let Some(req_os) = os_obj.get("name").and_then(|v| v.as_str()) {
                let norm_req = if req_os == "macos" { "osx" } else { req_os };
                if norm_req != os_name {
                    matches = false;
                }
            }
            if matches {
                if let Some(req_arch) = os_obj.get("arch").and_then(|v| v.as_str()) {
                    let norm_arch = match req_arch {
                        "aarch64" => "arm64",
                        "amd64" => "x86_64",
                        other => other,
                    };
                    if norm_arch != arch_name {
                        matches = false;
                    }
                }
            }
        }

        if matches {
            if let Some(feat_obj) = rule.get("features").and_then(|v| v.as_object()) {
                for (feat_key, feat_val) in feat_obj {
                    let expected = feat_val.as_bool().unwrap_or(true);
                    if features.contains(feat_key.as_str()) != expected {
                        matches = false;
                        break;
                    }
                }
            }
        }

        if matches {
            allowed = action == "allow";
        }
    }

    allowed
}

pub fn eval_rules(rules_val: Option<&Value>, features: &HashSet<&str>) -> bool {
    eval_rules_for(rules_val, current_mojang_os(), current_mojang_arch(), features)
}

fn sha1_file_hex(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

fn verify_file_integrity(
    path: &Path,
    expected_sha1: Option<&str>,
    expected_size: Option<u64>,
) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.len() == 0 {
        return false;
    }
    if let Some(sz) = expected_size {
        if sz > 0 && meta.len() != sz {
            return false;
        }
    }
    if let Some(sha1) = expected_sha1 {
        if !sha1.is_empty() {
            return sha1_file_hex(path)
                .map(|actual| actual.eq_ignore_ascii_case(sha1))
                .unwrap_or(false);
        }
    }
    true
}

async fn download_batch_concurrent(
    app: &AppHandle,
    client: &reqwest::Client,
    tasks: Vec<DownloadTask>,
    label: &str,
) -> Result<(), String> {
    let total = tasks.len();
    if total == 0 {
        return Ok(());
    }

    let missing: Vec<DownloadTask> = tokio::task::spawn_blocking(move || {
        tasks
            .into_par_iter()
            .filter(|t| {
                !verify_file_integrity(
                    &t.dest,
                    t.expected_sha1.as_deref(),
                    t.expected_size,
                )
            })
            .collect()
    })
    .await
    .map_err(|e| format!("Błąd weryfikacji plików {label}: {e}"))?;

    if missing.is_empty() {
        return Ok(());
    }

    let missing_total = missing.len();
    emit_status(
        app,
        format!("Pobieranie plików gry ({label}: 0/{missing_total})..."),
    );

    let done = Arc::new(AtomicUsize::new(0));
    let sem = Arc::new(Semaphore::new(14));

    let results: Vec<Result<(), String>> = stream::iter(missing.into_iter())
        .map(|task| {
            let client = client.clone();
            let app = app.clone();
            let done = done.clone();
            let sem = sem.clone();
            let label = label.to_string();

            async move {
                let _permit = sem
                    .acquire_owned()
                    .await
                    .map_err(|e| format!("Błąd semafora: {e}"))?;

                let mut last_err = String::new();
                for attempt in 0..2 {
                    match download_file_stream::<fn(_)>(
                        &client,
                        &task.url,
                        &task.dest,
                        None,
                    )
                    .await
                    {
                        Ok(()) => {
                            if let Some(ref sha1) = task.expected_sha1 {
                                let dest_check = task.dest.clone();
                                let sha1_clone = sha1.clone();
                                let ok = tokio::task::spawn_blocking(move || {
                                    verify_file_integrity(&dest_check, Some(&sha1_clone), None)
                                })
                                .await
                                .unwrap_or(false);
                                if ok {
                                    last_err.clear();
                                    break;
                                }
                                last_err = format!(
                                    "Niezgodna suma SHA1 dla {}",
                                    task.dest.display()
                                );
                            } else {
                                last_err.clear();
                                break;
                            }
                        }
                        Err(e) => {
                            last_err = e;
                        }
                    }
                    if attempt == 0 {
                        tokio::time::sleep(Duration::from_millis(300)).await;
                    }
                }

                if !last_err.is_empty() {
                    return Err(last_err);
                }

                let current = done.fetch_add(1, Ordering::Relaxed) + 1;
                if current % 10 == 0 || current == missing_total {
                    let percent = ((current as f64 / missing_total as f64) * 100.0).round() as u8;
                    let _ = app.emit(
                        "launch-progress",
                        json!({
                            "status": "game_download",
                            "progress": percent,
                            "detail": format!("{label}: {current}/{missing_total}")
                        }),
                    );
                    emit_status(
                        &app,
                        format!("Pobieranie plików gry ({label}: {current}/{missing_total})..."),
                    );
                }

                Ok(())
            }
        })
        .buffer_unordered(16)
        .collect()
        .await;

    for res in results {
        res?;
    }

    Ok(())
}

pub fn build_gc_args(
    jvm_profile: &str,
    ram_mb: u64,
    total_system_ram_mb: u64,
    required_java_ver: u32,
    custom_jvm_args: &str,
) -> (String, Vec<String>) {
    let mut profile_to_use = if jvm_profile.trim().is_empty() {
        "auto"
    } else {
        jvm_profile.trim()
    };

    if profile_to_use == "auto" {
        profile_to_use = if total_system_ram_mb <= 4500 {
            "ultra_potato"
        } else if total_system_ram_mb <= 8500 {
            "potato"
        } else if total_system_ram_mb <= 16500 {
            "optimized_g1gc"
        } else {
            "extreme_zgc"
        };
    }

    if profile_to_use == "extreme_zgc" && required_java_ver == 8 {
        profile_to_use = "optimized_g1gc";
    }

    let safe_ram = ram_mb.max(512);
    let large_heap = safe_ram > 12288;
    let g1_heap_region_size = if large_heap { "16M" } else { "8M" };
    let g1_new_size_pct = if large_heap { 40 } else { 30 };
    let g1_max_new_size_pct = if large_heap { 50 } else { 40 };
    let ihop = if large_heap { 20 } else { 15 };
    let zgc_soft_max = ((safe_ram as f64 * 0.80).floor() as u64).max(4096);

    let mut args: Vec<String> = match profile_to_use {
        "ultra_potato" => vec![
            "-XX:+UseG1GC",
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:MaxGCPauseMillis=200",
            "-XX:+ParallelRefProcEnabled",
            "-XX:+DisableExplicitGC",
            "-XX:-AlwaysPreTouch",
            "-XX:G1NewSizePercent=10",
            "-XX:G1MaxNewSizePercent=20",
            "-XX:G1ReservePercent=10",
            "-XX:G1HeapWastePercent=5",
            "-XX:G1MixedGCCountTarget=4",
            "-XX:G1HeapRegionSize=4M",
            "-XX:InitiatingHeapOccupancyPercent=25",
            "-XX:G1MixedGCLiveThresholdPercent=90",
            "-XX:G1RSetUpdatingPauseTimePercent=5",
            "-XX:SurvivorRatio=32",
            "-XX:MaxTenuringThreshold=1",
            "-XX:+PerfDisableSharedMem",
            "-XX:ConcGCThreads=1",
            "-XX:ParallelGCThreads=2",
            "-Dusing.aikars.flags=https://mcflags.emc.gs",
            "-Daikars.new.flags=true",
        ]
        .into_iter()
        .map(|s| s.to_string())
        .collect(),

        "potato" => vec![
            "-XX:+UseG1GC",
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:MaxGCPauseMillis=200",
            "-XX:+ParallelRefProcEnabled",
            "-XX:+DisableExplicitGC",
            "-XX:+AlwaysPreTouch",
            "-XX:G1NewSizePercent=20",
            "-XX:G1MaxNewSizePercent=30",
            "-XX:G1ReservePercent=20",
            "-XX:G1HeapWastePercent=5",
            "-XX:G1MixedGCCountTarget=4",
            "-XX:G1HeapRegionSize=8M",
            "-XX:InitiatingHeapOccupancyPercent=15",
            "-XX:G1MixedGCLiveThresholdPercent=90",
            "-XX:G1RSetUpdatingPauseTimePercent=5",
            "-XX:SurvivorRatio=32",
            "-XX:MaxTenuringThreshold=1",
            "-XX:+PerfDisableSharedMem",
            "-Dusing.aikars.flags=https://mcflags.emc.gs",
            "-Daikars.new.flags=true",
        ]
        .into_iter()
        .map(|s| s.to_string())
        .collect(),

        "optimized_g1gc" => vec![
            "-XX:+UseG1GC".to_string(),
            "-XX:+UnlockExperimentalVMOptions".to_string(),
            "-XX:MaxGCPauseMillis=200".to_string(),
            "-XX:+ParallelRefProcEnabled".to_string(),
            "-XX:+DisableExplicitGC".to_string(),
            "-XX:+AlwaysPreTouch".to_string(),
            format!("-XX:G1NewSizePercent={g1_new_size_pct}"),
            format!("-XX:G1MaxNewSizePercent={g1_max_new_size_pct}"),
            "-XX:G1ReservePercent=20".to_string(),
            "-XX:G1HeapWastePercent=5".to_string(),
            "-XX:G1MixedGCCountTarget=4".to_string(),
            format!("-XX:G1HeapRegionSize={g1_heap_region_size}"),
            format!("-XX:InitiatingHeapOccupancyPercent={ihop}"),
            "-XX:G1MixedGCLiveThresholdPercent=90".to_string(),
            "-XX:G1RSetUpdatingPauseTimePercent=5".to_string(),
            "-XX:SurvivorRatio=32".to_string(),
            "-XX:+PerfDisableSharedMem".to_string(),
            "-XX:MaxTenuringThreshold=1".to_string(),
            "-Dusing.aikars.flags=https://mcflags.emc.gs".to_string(),
            "-Daikars.new.flags=true".to_string(),
        ],

        "extreme_zgc" => {
            let mut zgc = vec![
                "-XX:+UseZGC".to_string(),
                "-XX:+UnlockExperimentalVMOptions".to_string(),
                "-XX:+AlwaysPreTouch".to_string(),
                "-XX:+DisableExplicitGC".to_string(),
                "-XX:+ParallelRefProcEnabled".to_string(),
                format!("-XX:SoftMaxHeapSize={zgc_soft_max}m"),
                "-XX:+PerfDisableSharedMem".to_string(),
                "-XX:ZUncommitDelay=600".to_string(),
            ];
            if required_java_ver == 21 {
                zgc.push("-XX:+ZGenerational".to_string());
            }
            zgc
        }

        _ => Vec::new(),
    };

    let trimmed_custom = custom_jvm_args.trim();
    if !trimmed_custom.is_empty() {
        for tok in trimmed_custom.split_whitespace() {
            args.push(tok.to_string());
        }
    }

    (profile_to_use.to_string(), args)
}

pub fn substitute_placeholders(input: &str, fields: &HashMap<&str, String>) -> String {
    let mut out = input.to_string();
    for (k, v) in fields {
        if out.contains(k) {
            out = out.replace(k, v);
        }
    }
    out
}

fn resolve_auth(cfg: &LauncherConfig) -> ResolvedAuth {
    let default_name = if cfg.nickname.trim().is_empty() {
        "Gracz".to_string()
    } else {
        cfg.nickname.clone()
    };

    if cfg.login_type == "microsoft" {
        if let Some(ref ms_auth) = cfg.microsoft_auth {
            let profile = ms_auth.get("profile").unwrap_or(ms_auth);
            let access_token = profile
                .get("access_token")
                .or_else(|| ms_auth.get("access_token"))
                .and_then(|v| v.as_str())
                .unwrap_or("token")
                .to_string();
            let client_token = profile
                .get("client_token")
                .and_then(|v| v.as_str())
                .unwrap_or("client")
                .to_string();
            let uuid = profile
                .get("uuid")
                .or_else(|| ms_auth.get("uuid"))
                .and_then(|v| v.as_str())
                .unwrap_or("uuid")
                .to_string();
            let name = profile
                .get("name")
                .or_else(|| ms_auth.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or(&default_name)
                .to_string();
            let meta = profile.get("meta");
            let user_type = meta
                .and_then(|m| m.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("msa")
                .to_string();
            let xuid = meta
                .and_then(|m| m.get("xuid"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| access_token.clone());
            let is_demo = meta
                .and_then(|m| m.get("demo"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let user_properties = match profile.get("user_properties") {
                Some(Value::String(s)) => s.clone(),
                Some(v) if !v.is_null() => serde_json::to_string(v).unwrap_or_else(|_| "{}".into()),
                _ => "{}".to_string(),
            };

            return ResolvedAuth {
                access_token,
                client_token,
                uuid,
                name,
                user_type,
                xuid,
                user_properties,
                is_demo,
            };
        }
    }

    ResolvedAuth {
        access_token: "token".to_string(),
        client_token: "client".to_string(),
        uuid: "uuid".to_string(),
        name: default_name,
        user_type: "mojang".to_string(),
        xuid: "token".to_string(),
        user_properties: "{}".to_string(),
        is_demo: false,
    }
}

fn parse_mc_minor(mc_ver: &str) -> u32 {
    mc_ver
        .split('.')
        .nth(1)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(20)
}

fn append_game_arg_entries(
    raw_items: &[Value],
    features: &HashSet<&str>,
    out: &mut Vec<String>,
) {
    for item in raw_items {
        if let Some(s) = item.as_str() {
            out.push(s.to_string());
        } else if let Some(obj) = item.as_object() {
            let allowed = eval_rules(obj.get("rules"), features);
            if !allowed {
                continue;
            }
            if let Some(val) = obj.get("value") {
                if let Some(s) = val.as_str() {
                    out.push(s.to_string());
                } else if let Some(arr) = val.as_array() {
                    for elem in arr {
                        if let Some(es) = elem.as_str() {
                            out.push(es.to_string());
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn launch_game(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    if state.is_game_running() {
        return Ok(json!({ "success": false, "error": "Gra jest już uruchomiona!" }));
    }

    let mut cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };

    if let Err(e) = refresh_minecraft_token_if_needed(&state, &mut cfg).await {
        state.log_to_file(&format!(
            "[AUTH] Ostrzeżenie odświeżania tokena MS: {e}"
        ));
    }

    let game_dir = PathBuf::from(&cfg.game_dir);
    if let Err(e) = fs::create_dir_all(&game_dir) {
        return Ok(
            json!({ "success": false, "error": format!("Nie udało się utworzyć katalogu gry: {e}") }),
        );
    }

    let mods_dir = game_dir.join("mods");
    let state_ref = Arc::new(mods_dir.clone());
    let cache_for_clean = state.mod_cache.clone();
    let app_log = state.log_path.clone();
    let _ = tokio::task::spawn_blocking(move || {
        // Bezpieczne czyszczenie duplikatów przy starcie
        if !state_ref.exists() {
            return;
        }
        let jar_paths: Vec<PathBuf> = fs::read_dir(state_ref.as_path())
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| {
                        let f = e.file_name().to_string_lossy().to_string();
                        if f.to_ascii_lowercase().ends_with(".jar") {
                            Some(e.path())
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        let entries: Vec<(String, String, PathBuf, u128)> = jar_paths
            .par_iter()
            .filter_map(|path| {
                let meta = crate::modrinth::get_jar_mod_metadata(&cache_for_clean, path)?;
                let mod_id = meta.id?;
                let mtime = fs::metadata(path)
                    .ok()?
                    .modified()
                    .ok()?
                    .duration_since(UNIX_EPOCH)
                    .ok()?
                    .as_millis();
                let filename = path.file_name()?.to_string_lossy().to_string();
                Some((mod_id, filename, path.clone(), mtime))
            })
            .collect();

        let mut by_id: HashMap<String, Vec<(String, PathBuf, u128)>> = HashMap::new();
        for (mod_id, filename, path, mtime) in entries {
            by_id
                .entry(mod_id)
                .or_default()
                .push((filename, path, mtime));
        }

        let mut disabled_list = Vec::new();
        for (_, mut list) in by_id {
            if list.len() > 1 {
                list.sort_by(|a, b| b.2.cmp(&a.2));
                for (filename, path, _) in list.into_iter().skip(1) {
                    let disabled_path = PathBuf::from(format!("{}.disabled", path.display()));
                    if path.exists() && fs::rename(&path, &disabled_path).is_ok() {
                        disabled_list.push(filename);
                    }
                }
            }
        }
        if !disabled_list.is_empty() {
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(app_log) {
                let _ = writeln!(
                    f,
                    "[SYSTEM] Wykryto i wyłączono duplikaty modów: {}",
                    disabled_list.join(", ")
                );
            }
        }
    })
    .await;
    // Zachowaj użycie clean_duplicate_mods publicznie dla testów / bezpośrednich wywołań
    let _ = clean_duplicate_mods as fn(&AppState, &Path);

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    state.reset_log_file(&format!("--- LOG URUCHOMIENIA GRY - unix:{now_secs} ---"));

    match launch_game_inner(&app, &state, &mut cfg, &game_dir).await {
        Ok(()) => Ok(json!({ "success": true })),
        Err(err) => {
            emit_status(&app, format!("Błąd uruchamiania: {err}"));
            let _ = app.emit(
                "launch-progress",
                json!({ "status": "error", "error": err }),
            );
            state.log_to_file(&format!("[ERROR] {err}"));
            Ok(json!({ "success": false, "error": err }))
        }
    }
}

async fn launch_game_inner(
    app: &AppHandle,
    state: &AppState,
    cfg: &mut LauncherConfig,
    game_dir: &Path,
) -> Result<(), String> {
    let mc_ver = if cfg.minecraft_version.trim().is_empty() {
        "1.20.1".to_string()
    } else {
        cfg.minecraft_version.clone()
    };

    let required_java = determine_required_java_version(&cfg.java_version, &mc_ver);
    let final_java_path = ensure_java_runtime(app, state, game_dir, cfg, required_java).await?;
    emit_status(app, format!("Java: {final_java_path}"));
    state.log_to_file(&format!("[SYSTEM] Używana Java: {final_java_path}"));

    emit_status(app, "Sprawdzanie najnowszej wersji Fabric Loader...");
    let mut loader_ver = if cfg.loader_version.trim().is_empty() {
        "0.19.5".to_string()
    } else {
        cfg.loader_version.clone()
    };
    if let Some(latest_fabric) = get_latest_fabric_loader(&state.http_client, &mc_ver).await {
        if latest_fabric != cfg.loader_version {
            state.log_to_file(&format!(
                "[Fabric] Aktualizacja wersji Fabric Loader: {} -> {latest_fabric}",
                cfg.loader_version
            ));
            cfg.loader_version = latest_fabric.clone();
            {
                let _g = state.config_lock.lock().await;
                let _ = state.write_config(cfg);
            }
            let _ = app.emit("config-updated", &*cfg);
        }
        loader_ver = latest_fabric;
    }

    emit_status(app, format!("Silnik Fabric: {loader_ver}"));
    emit_status(
        app,
        "Uruchamianie gry Minecraft (pobieranie plików i bibliotek)...",
    );

    let fabric_version_id = format!("fabric-loader-{loader_ver}-{mc_ver}");
    let version_dir = game_dir.join("versions").join(&fabric_version_id);
    fs::create_dir_all(&version_dir)
        .map_err(|e| format!("Błąd tworzenia katalogu wersji: {e}"))?;

    let fabric_json_path = version_dir.join(format!("{fabric_version_id}.json"));
    if !fabric_json_path.exists() {
        let fabric_meta_url =
            format!("https://meta.fabricmc.net/v2/versions/loader/{mc_ver}/{loader_ver}/profile/json");
        let resp = state
            .http_client
            .get(&fabric_meta_url)
            .timeout(Duration::from_secs(12))
            .send()
            .await
            .map_err(|e| {
                format!("Nie udało się pobrać konfiguracji profilu Fabric z meta.fabricmc.net ({e})")
            })?;
        if !resp.status().is_success() {
            return Err(format!(
                "Nie udało się pobrać profilu Fabric (HTTP {})",
                resp.status().as_u16()
            ));
        }
        let body_val = resp
            .json::<Value>()
            .await
            .map_err(|e| format!("Błąd parsowania JSON profilu Fabric: {e}"))?;
        let pretty = serde_json::to_string_pretty(&body_val)
            .map_err(|e| format!("Błąd serializacji profilu Fabric: {e}"))?;
        fs::write(&fabric_json_path, pretty)
            .map_err(|e| format!("Błąd zapisu profilu Fabric: {e}"))?;
    }

    let fabric_raw = fs::read_to_string(&fabric_json_path)
        .map_err(|e| format!("Błąd odczytu {fabric_version_id}.json: {e}"))?;
    let fabric_json: Value = serde_json::from_str(&fabric_raw)
        .map_err(|e| format!("Błąd parsowania {fabric_version_id}.json: {e}"))?;

    // Vanilla version JSON
    let vanilla_json_path = version_dir.join(format!("{mc_ver}.json"));
    if !vanilla_json_path.exists() {
        let manifest_resp = state
            .http_client
            .get(MOJANG_MANIFEST_V2)
            .timeout(Duration::from_secs(12))
            .send()
            .await
            .map_err(|e| format!("Błąd pobierania version_manifest_v2.json ({e})"))?;
        if !manifest_resp.status().is_success() {
            return Err(format!(
                "Błąd Mojang version_manifest_v2 (HTTP {})",
                manifest_resp.status().as_u16()
            ));
        }
        let manifest: Value = manifest_resp
            .json()
            .await
            .map_err(|e| format!("Błąd JSON version_manifest: {e}"))?;
        let ver_url = manifest
            .get("versions")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|v| v.get("id").and_then(|i| i.as_str()) == Some(mc_ver.as_str()))
            })
            .and_then(|v| v.get("url"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("Nie znaleziono wersji {mc_ver} w manifeście Mojang."))?
            .to_string();

        let ver_resp = state
            .http_client
            .get(&ver_url)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Błąd pobierania {mc_ver}.json ({e})"))?;
        let ver_text = ver_resp
            .text()
            .await
            .map_err(|e| format!("Błąd odczytu {mc_ver}.json: {e}"))?;
        fs::write(&vanilla_json_path, ver_text)
            .map_err(|e| format!("Błąd zapisu {mc_ver}.json: {e}"))?;
    }

    let vanilla_raw = fs::read_to_string(&vanilla_json_path)
        .map_err(|e| format!("Błąd odczytu {mc_ver}.json: {e}"))?;
    let vanilla_json: Value = serde_json::from_str(&vanilla_raw)
        .map_err(|e| format!("Błąd parsowania {mc_ver}.json: {e}"))?;

    // Klient JAR (MCLC: {versionDir}/{fabricVersionId}.jar)
    let client_jar_path = version_dir.join(format!("{fabric_version_id}.jar"));
    if let Some(client_dl) = vanilla_json.get("downloads").and_then(|d| d.get("client")) {
        let url = client_dl
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Brak URL klienta Minecraft w JSON wersji.".to_string())?;
        let sha1 = client_dl.get("sha1").and_then(|v| v.as_str());
        let size = client_dl.get("size").and_then(|v| v.as_u64());

        let check_path = client_jar_path.clone();
        let sha1_own = sha1.map(|s| s.to_string());
        let valid = tokio::task::spawn_blocking(move || {
            verify_file_integrity(&check_path, sha1_own.as_deref(), size)
        })
        .await
        .unwrap_or(false);

        if !valid {
            emit_status(app, format!("Pobieranie pliku klienta Minecraft {mc_ver}..."));
            download_file_stream::<fn(_)>(
                &state.download_client,
                url,
                &client_jar_path,
                None,
            )
            .await?;
        }
    }

    let libraries_dir = game_dir.join("libraries");
    let empty_features: HashSet<&str> = HashSet::new();
    let mut lib_tasks: Vec<DownloadTask> = Vec::new();
    let mut classpath_entries: Vec<PathBuf> = Vec::new();
    let mut seen_classpath: HashSet<PathBuf> = HashSet::new();
    let mut fabric_overrides: HashSet<(String, String, String)> = HashSet::new();

    // 1. Biblioteki Fabric
    if let Some(fabric_libs) = fabric_json.get("libraries").and_then(|v| v.as_array()) {
        for lib in fabric_libs {
            if !eval_rules(lib.get("rules"), &empty_features) {
                continue;
            }
            let Some(coord_str) = lib.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(parsed) = parse_maven_coord(coord_str) else {
                continue;
            };

            fabric_overrides.insert((
                parsed.group.clone(),
                parsed.artifact.clone(),
                parsed.classifier.clone(),
            ));

            let (rel_path, url, sha1, size) = if let Some(art) =
                lib.get("downloads").and_then(|d| d.get("artifact"))
            {
                let path = art
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&parsed.rel_path)
                    .to_string();
                let url = art
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        let base = lib
                            .get("url")
                            .and_then(|v| v.as_str())
                            .unwrap_or("https://maven.fabricmc.net/");
                        let slash = if base.ends_with('/') { "" } else { "/" };
                        format!("{base}{slash}{path}")
                    });
                let sha1 = art
                    .get("sha1")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let size = art.get("size").and_then(|v| v.as_u64());
                (path, url, sha1, size)
            } else {
                let base = lib
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("https://maven.fabricmc.net/");
                let slash = if base.ends_with('/') { "" } else { "/" };
                let url = format!("{base}{slash}{}", parsed.rel_path);
                let sha1 = lib
                    .get("sha1")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let size = lib.get("size").and_then(|v| v.as_u64());
                (parsed.rel_path.clone(), url, sha1, size)
            };

            let dest = libraries_dir.join(&rel_path);
            if seen_classpath.insert(dest.clone()) {
                classpath_entries.push(dest.clone());
                lib_tasks.push(DownloadTask {
                    url,
                    dest,
                    expected_sha1: sha1,
                    expected_size: size,
                });
            }
        }
    }

    // 2. Biblioteki Vanilla Mojang (z pominięciem nadpisanych przez Fabric + ewentualne natives <1.19)
    let mc_minor = parse_mc_minor(&mc_ver);
    let mut native_jars_to_extract: Vec<DownloadTask> = Vec::new();
    let natives_dir = if mc_minor >= 19 {
        game_dir.to_path_buf()
    } else {
        game_dir.join("natives").join(&mc_ver)
    };

    if let Some(vanilla_libs) = vanilla_json.get("libraries").and_then(|v| v.as_array()) {
        for lib in vanilla_libs {
            if !eval_rules(lib.get("rules"), &empty_features) {
                continue;
            }
            if let Some(coord_str) = lib.get("name").and_then(|v| v.as_str()) {
                if let Some(parsed) = parse_maven_coord(coord_str) {
                    let overridden = fabric_overrides.contains(&(
                        parsed.group.clone(),
                        parsed.artifact.clone(),
                        parsed.classifier.clone(),
                    ));
                    if !overridden {
                        if let Some(art) = lib.get("downloads").and_then(|d| d.get("artifact")) {
                            let path = art
                                .get("path")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&parsed.rel_path);
                            if let Some(url) = art.get("url").and_then(|v| v.as_str()) {
                                if !url.is_empty() {
                                    let dest = libraries_dir.join(path);
                                    if seen_classpath.insert(dest.clone()) {
                                        classpath_entries.push(dest.clone());
                                        lib_tasks.push(DownloadTask {
                                            url: url.to_string(),
                                            dest,
                                            expected_sha1: art
                                                .get("sha1")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                            expected_size: art.get("size").and_then(|v| v.as_u64()),
                                        });
                                    }
                                }
                            }
                        } else if let Some(url_base) = lib.get("url").and_then(|v| v.as_str()) {
                            let slash = if url_base.ends_with('/') { "" } else { "/" };
                            let dest = libraries_dir.join(&parsed.rel_path);
                            if seen_classpath.insert(dest.clone()) {
                                classpath_entries.push(dest.clone());
                                lib_tasks.push(DownloadTask {
                                    url: format!("{url_base}{slash}{}", parsed.rel_path),
                                    dest,
                                    expected_sha1: None,
                                    expected_size: None,
                                });
                            }
                        } else if let Some(downloads) = lib.get("downloads") {
                            let _ = (downloads, MOJANG_LIBRARIES_BASE);
                        }
                    }
                }
            }

            if mc_minor < 19 {
                if let Some(classifiers) = lib.get("downloads").and_then(|d| d.get("classifiers")) {
                    let os_key = current_mojang_os();
                    let native_obj = if os_key == "osx" {
                        classifiers
                            .get("natives-osx")
                            .or_else(|| classifiers.get("natives-macos"))
                    } else if os_key == "windows" {
                        classifiers.get("natives-windows")
                    } else {
                        classifiers.get("natives-linux")
                    };
                    if let Some(nat) = native_obj {
                        if let (Some(url), Some(rel_p)) = (
                            nat.get("url").and_then(|v| v.as_str()),
                            nat.get("path").and_then(|v| v.as_str()),
                        ) {
                            let fname = Path::new(rel_p)
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            native_jars_to_extract.push(DownloadTask {
                                url: url.to_string(),
                                dest: natives_dir.join(fname),
                                expected_sha1: nat
                                    .get("sha1")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                expected_size: nat.get("size").and_then(|v| v.as_u64()),
                            });
                        }
                    }
                }
            }
        }
    }

    download_batch_concurrent(app, &state.download_client, lib_tasks, "classes").await?;

    if mc_minor < 19 && !native_jars_to_extract.is_empty() {
        fs::create_dir_all(&natives_dir)
            .map_err(|e| format!("Błąd tworzenia natives: {e}"))?;
        let nat_clones = native_jars_to_extract.clone();
        download_batch_concurrent(app, &state.download_client, native_jars_to_extract, "natives")
            .await?;
        let nat_dir_clone = natives_dir.clone();
        tokio::task::spawn_blocking(move || {
            for t in nat_clones {
                if let Ok(file) = File::open(&t.dest) {
                    if let Ok(mut archive) = ZipArchive::new(file) {
                        for i in 0..archive.len() {
                            if let Ok(mut entry) = archive.by_index(i) {
                                let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf())
                                else {
                                    continue;
                                };
                                let rel_str = rel.to_string_lossy();
                                if rel_str.starts_with("META-INF") || entry.is_dir() {
                                    continue;
                                }
                                let out_p = nat_dir_clone.join(rel);
                                if let Some(p) = out_p.parent() {
                                    let _ = fs::create_dir_all(p);
                                }
                                if let Ok(mut out) = File::create(&out_p) {
                                    let _ = io::copy(&mut entry, &mut out);
                                }
                            }
                        }
                    }
                }
                let _ = fs::remove_file(&t.dest);
            }
        })
        .await
        .map_err(|e| format!("Błąd rozpakowywania natives: {e}"))?;
    }

    // 3. Assety Minecraft
    let assets_root = game_dir.join("assets");
    let indexes_dir = assets_root.join("indexes");
    let objects_dir = assets_root.join("objects");
    fs::create_dir_all(&indexes_dir)
        .map_err(|e| format!("Błąd tworzenia assets/indexes: {e}"))?;
    fs::create_dir_all(&objects_dir)
        .map_err(|e| format!("Błąd tworzenia assets/objects: {e}"))?;

    let asset_index_id = fabric_version_id.clone();
    let asset_index_path = indexes_dir.join(format!("{asset_index_id}.json"));
    if let Some(asset_info) = vanilla_json.get("assetIndex") {
        let idx_url = asset_info
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Brak assetIndex.url w JSON wersji.".to_string())?;
        let idx_sha1 = asset_info.get("sha1").and_then(|v| v.as_str());
        let check_idx = asset_index_path.clone();
        let sha1_own = idx_sha1.map(|s| s.to_string());
        let valid = tokio::task::spawn_blocking(move || {
            verify_file_integrity(&check_idx, sha1_own.as_deref(), None)
        })
        .await
        .unwrap_or(false);

        if !valid {
            download_file_stream::<fn(_)>(
                &state.download_client,
                idx_url,
                &asset_index_path,
                None,
            )
            .await?;
        }
    }

    let index_raw = fs::read_to_string(&asset_index_path)
        .map_err(|e| format!("Błąd odczytu indeksu assetów: {e}"))?;
    let index_json: Value = serde_json::from_str(&index_raw)
        .map_err(|e| format!("Błąd parsowania indeksu assetów: {e}"))?;

    let mut asset_tasks: Vec<DownloadTask> = Vec::new();
    let mut legacy_copy_list: Vec<(String, PathBuf)> = Vec::new();
    if let Some(objects) = index_json.get("objects").and_then(|v| v.as_object()) {
        asset_tasks.reserve(objects.len());
        for (asset_name, obj) in objects {
            let Some(hash) = obj.get("hash").and_then(|v| v.as_str()) else {
                continue;
            };
            if hash.len() < 2 {
                continue;
            }
            let size = obj.get("size").and_then(|v| v.as_u64());
            let subhash = &hash[..2];
            let dest = objects_dir.join(subhash).join(hash);
            legacy_copy_list.push((asset_name.clone(), dest.clone()));
            asset_tasks.push(DownloadTask {
                url: format!("{MOJANG_RESOURCES_BASE}/{subhash}/{hash}"),
                dest,
                expected_sha1: Some(hash.to_string()),
                expected_size: size,
            });
        }
    }

    download_batch_concurrent(app, &state.download_client, asset_tasks, "assets").await?;

    let is_legacy_assets = vanilla_json
        .get("assets")
        .and_then(|v| v.as_str())
        .map(|s| s == "legacy" || s == "pre-1.6")
        .unwrap_or(false);
    if is_legacy_assets {
        let resources_dir = game_dir.join("resources");
        tokio::task::spawn_blocking(move || {
            for (rel_asset, src) in legacy_copy_list {
                let dst = resources_dir.join(&rel_asset);
                if !dst.exists() && src.exists() {
                    if let Some(parent) = dst.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let _ = fs::copy(&src, &dst);
                }
            }
        })
        .await
        .map_err(|e| format!("Błąd kopiowania legacy resources: {e}"))?;
    }

    // 4. Budowanie argumentów JVM + klasy startowej + argumentów gry
    classpath_entries.push(client_jar_path);
    let cp_sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let classpath_str = classpath_entries
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(cp_sep);

    let total_ram_mb = get_total_ram_mb();
    let ram_mb = if cfg.ram > 0 { cfg.ram } else { 4096 };
    let (used_profile, gc_args) = build_gc_args(
        &cfg.jvm_profile,
        ram_mb,
        total_ram_mb,
        required_java,
        &cfg.custom_jvm_args,
    );
    state.log_to_file(&format!(
        "[SYSTEM] Profil JVM: {used_profile} (Dostępna pamięć: {total_ram_mb} MB)"
    ));

    let mut launch_args: Vec<String> = vec![
        "-XX:-UseAdaptiveSizePolicy".to_string(),
        "-XX:-OmitStackTraceInFastThrow".to_string(),
        "-Dfml.ignorePatchDiscrepancies=true".to_string(),
        "-Dfml.ignoreInvalidMinecraftCertificates=true".to_string(),
        format!("-Djava.library.path={}", natives_dir.display()),
        format!("-Xmx{ram_mb}M"),
        format!("-Xms{ram_mb}M"),
    ];

    match current_mojang_os() {
        "windows" => launch_args.push(
            "-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump"
                .to_string(),
        ),
        "osx" => launch_args.push("-XstartOnFirstThread".to_string()),
        _ => launch_args.push("-Xss1M".to_string()),
    }

    if let Some(fabric_jvm) = fabric_json
        .get("arguments")
        .and_then(|a| a.get("jvm"))
        .and_then(|j| j.as_array())
    {
        for item in fabric_jvm {
            if let Some(s) = item.as_str() {
                launch_args.push(s.to_string());
            }
        }
    }

    if (mc_minor == 18 && mc_ver == "1.18") || mc_minor == 17 {
        launch_args.push("-Dlog4j2.formatMsgNoLookups=true".to_string());
    }

    if !gc_args.is_empty() {
        state.log_to_file(&format!(
            "[SYSTEM] Kompletne argumenty JVM: {}",
            gc_args.join(" ")
        ));
        launch_args.extend(gc_args);
    }

    let main_class = fabric_json
        .get("mainClass")
        .or_else(|| vanilla_json.get("mainClass"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak mainClass w konfiguracji Fabric/Minecraft.".to_string())?
        .to_string();

    launch_args.push("-cp".to_string());
    launch_args.push(classpath_str);
    launch_args.push(main_class);

    // Argumenty gry
    let auth = resolve_auth(cfg);
    let game_features: HashSet<&str> = HashSet::new();
    let mut raw_game_args: Vec<String> = Vec::new();

    if let Some(fabric_game) = fabric_json
        .get("arguments")
        .and_then(|a| a.get("game"))
        .and_then(|g| g.as_array())
    {
        append_game_arg_entries(fabric_game, &game_features, &mut raw_game_args);
    }

    if raw_game_args.len() < 11 {
        if let Some(vanilla_game) = vanilla_json
            .get("arguments")
            .and_then(|a| a.get("game"))
            .and_then(|g| g.as_array())
        {
            append_game_arg_entries(vanilla_game, &game_features, &mut raw_game_args);
        } else if let Some(legacy_mc_args) =
            vanilla_json.get("minecraftArguments").and_then(|v| v.as_str())
        {
            for tok in legacy_mc_args.split_whitespace() {
                raw_game_args.push(tok.to_string());
            }
        }
    }

    if auth.is_demo {
        raw_game_args.push("--demo".to_string());
    }

    let assets_arg_path = if is_legacy_assets {
        game_dir.join("resources")
    } else {
        assets_root.clone()
    };

    let mut fields: HashMap<&str, String> = HashMap::new();
    fields.insert("${auth_access_token}", auth.access_token.clone());
    fields.insert("${auth_session}", auth.access_token.clone());
    fields.insert("${auth_player_name}", auth.name.clone());
    fields.insert("${auth_uuid}", auth.uuid.clone());
    fields.insert("${auth_xuid}", auth.xuid.clone());
    fields.insert("${user_properties}", auth.user_properties.clone());
    fields.insert("${user_type}", auth.user_type.clone());
    fields.insert("${version_name}", mc_ver.clone());
    fields.insert("${assets_index_name}", asset_index_id);
    fields.insert("${game_directory}", game_dir.to_string_lossy().to_string());
    fields.insert("${assets_root}", assets_arg_path.to_string_lossy().to_string());
    fields.insert("${game_assets}", assets_arg_path.to_string_lossy().to_string());
    fields.insert("${version_type}", "release".to_string());
    fields.insert("${clientid}", auth.client_token.clone());
    fields.insert("${resolution_width}", "856".to_string());
    fields.insert("${resolution_height}", "482".to_string());

    for arg in raw_game_args {
        launch_args.push(substitute_placeholders(&arg, &fields));
    }

    // 5. Uruchomienie procesu Java / Minecraft
    let mut cmd = AsyncCommand::new(&final_java_path);
    cmd.args(&launch_args)
        .current_dir(game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Nie udało się uruchomić procesu Minecraft: {e}"))?;

    let pid = child.id().unwrap_or(0);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (kill_tx, mut kill_rx) = oneshot::channel::<()>();
    {
        let mut active = state
            .active_game
            .lock()
            .map_err(|_| "Błąd blokady active_game".to_string())?;
        *active = Some(ActiveGame {
            pid,
            kill_tx: Some(kill_tx),
        });
    }

    if let Some(out) = stdout {
        let app_c = app.clone();
        let log_path_c = state.log_path.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = AsyncBufReader::new(out);
            let mut buf = Vec::new();
            while reader.read_until(b'\n', &mut buf).await.unwrap_or(0) > 0 {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app_c.emit("game-log", &line);
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path_c) {
                    let _ = write!(f, "{line}");
                }
                buf.clear();
            }
        });
    }

    if let Some(err_stream) = stderr {
        let app_c = app.clone();
        let log_path_c = state.log_path.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = AsyncBufReader::new(err_stream);
            let mut buf = Vec::new();
            while reader.read_until(b'\n', &mut buf).await.unwrap_or(0) > 0 {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app_c.emit("game-log", &line);
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path_c) {
                    let _ = write!(f, "{line}");
                }
                buf.clear();
            }
        });
    }

    let app_wait = app.clone();
    tauri::async_runtime::spawn(async move {
        let exit_code: i32 = tokio::select! {
            res = child.wait() => {
                match res {
                    Ok(status) => status.code().unwrap_or(-1),
                    Err(_) => -1,
                }
            }
            _ = &mut kill_rx => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                -9
            }
        };

        let st = app_wait.state::<AppState>();
        if let Ok(mut active) = st.active_game.lock() {
            *active = None;
        }

        let _ = app_wait.emit(
            "launch-progress",
            json!({ "status": "idle", "progress": 0 }),
        );
        emit_status(
            &app_wait,
            format!("Gra została wyłączona (kod: {exit_code})"),
        );
        st.log_to_file(&format!(
            "\n[SYSTEM] Gra została zamknięta z kodem wyjścia: {exit_code}"
        ));

        if let Some(win) = app_wait.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }

        // Odłożona aktualizacja AppImage po zamknięciu gry (Linux)
        let pending = st
            .pending_update_path
            .lock()
            .ok()
            .and_then(|g| g.clone());
        if let Some(file_path) = pending {
            let cfg_now = {
                let _g = st.config_lock.lock().await;
                st.read_config()
            };
            if cfg_now.auto_update_launcher && cfg!(target_os = "linux") {
                st.log_to_file(
                    "[SYSTEM] Gra zakończona. Uruchamianie odłożonej aktualizacji launchera...",
                );
                let _ = app_wait.emit("launcher-update-event", json!({ "status": "installing" }));
                tokio::time::sleep(Duration::from_millis(1000)).await;
                updater::install_update_file(&app_wait, &st, &file_path);
            }
        }
    });

    emit_status(
        app,
        "Gra pomyślnie wystartowała! Życzymy miłej zabawy.",
    );
    let _ = app.emit(
        "launch-progress",
        json!({ "status": "running", "progress": 100 }),
    );
    state.log_to_file("[SYSTEM] Pomyślnie przekazano kontrolę do procesu Minecraft.");

    let potato_mode = cfg.potato_mode;
    let app_hide = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let st = app_hide.state::<AppState>();
        if st.is_game_running() {
            if let Some(win) = app_hide.get_webview_window("main") {
                if potato_mode {
                    let _ = win.hide();
                } else {
                    let _ = win.minimize();
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn kill_game(state: State<'_, AppState>) -> Result<bool, String> {
    let maybe_active = {
        let Ok(mut guard) = state.active_game.lock() else {
            return Ok(false);
        };
        guard.take()
    };

    if let Some(mut game) = maybe_active {
        if let Some(tx) = game.kill_tx.take() {
            let _ = tx.send(());
        }
        #[cfg(unix)]
        if game.pid > 0 {
            let _ = std::process::Command::new("kill")
                .args(["-9", &game.pid.to_string()])
                .output();
        }
        #[cfg(windows)]
        if game.pid > 0 {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &game.pid.to_string(), "/F", "/T"])
                .creation_flags(0x0800_0000)
                .output();
        }
        return Ok(true);
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eval_rules_mojang() {
        let empty = HashSet::new();

        let osx_only = json!([
            { "action": "allow", "os": { "name": "osx" } }
        ]);
        assert!(!eval_rules_for(Some(&osx_only), "linux", "x86_64", &empty));
        assert!(eval_rules_for(Some(&osx_only), "osx", "x86_64", &empty));

        let not_osx = json!([
            { "action": "allow" },
            { "action": "disallow", "os": { "name": "osx" } }
        ]);
        assert!(eval_rules_for(Some(&not_osx), "linux", "x86_64", &empty));
        assert!(eval_rules_for(Some(&not_osx), "windows", "x86_64", &empty));
        assert!(!eval_rules_for(Some(&not_osx), "osx", "x86_64", &empty));

        let feat_rule = json!([
            { "action": "allow", "features": { "is_demo_user": true } }
        ]);
        assert!(!eval_rules_for(Some(&feat_rule), "linux", "x86_64", &empty));
        let mut demo_features = HashSet::new();
        demo_features.insert("is_demo_user");
        assert!(eval_rules_for(
            Some(&feat_rule),
            "linux",
            "x86_64",
            &demo_features
        ));
    }

    #[test]
    fn test_parse_maven_coord() {
        let a = parse_maven_coord("org.ow2.asm:asm:9.10.1").unwrap();
        assert_eq!(a.rel_path, "org/ow2/asm/asm/9.10.1/asm-9.10.1.jar");
        assert_eq!(a.classifier, "");

        let b = parse_maven_coord("org.lwjgl:lwjgl-glfw:3.3.1:natives-linux").unwrap();
        assert_eq!(
            b.rel_path,
            "org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-linux.jar"
        );
        assert_eq!(b.classifier, "natives-linux");
    }

    #[test]
    fn test_build_gc_args_profiles() {
        let (prof, args) = build_gc_args("auto", 8192, 16384, 17, "");
        assert_eq!(prof, "optimized_g1gc");
        assert!(args.iter().any(|a| a == "-XX:+UseG1GC"));
        assert!(args.iter().any(|a| a == "-XX:G1HeapRegionSize=8M"));

        let (prof_zgc, args_zgc) = build_gc_args("extreme_zgc", 10240, 32768, 21, "-Dfoo=bar");
        assert_eq!(prof_zgc, "extreme_zgc");
        assert!(args_zgc.iter().any(|a| a == "-XX:+ZGenerational"));
        assert!(args_zgc.iter().any(|a| a == "-Dfoo=bar"));

        let (prof_fallback, _) = build_gc_args("extreme_zgc", 4096, 32768, 8, "");
        assert_eq!(prof_fallback, "optimized_g1gc");
    }

    #[test]
    fn test_substitute_placeholders() {
        let mut fields = HashMap::new();
        fields.insert("${auth_player_name}", "Mati".to_string());
        fields.insert("${game_directory}", "/tmp/mc".to_string());
        assert_eq!(substitute_placeholders("${auth_player_name}", &fields), "Mati");
        assert_eq!(
            substitute_placeholders("--path=${game_directory}", &fields),
            "--path=/tmp/mc"
        );
    }
}


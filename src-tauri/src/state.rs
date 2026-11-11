use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sysinfo::{MemoryRefreshKind, RefreshKind, System};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex as TokioMutex};

use crate::modrinth::ModCacheState;

pub const DEFAULT_MINECRAFT_VERSION: &str = "1.20.1";
pub const DEFAULT_LOADER: &str = "fabric";
pub const DEFAULT_LOADER_VERSION: &str = "0.19.5";
pub const USER_AGENT: &str = "Ciapongi-RP-Launcher";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub nickname: String,
    #[serde(default)]
    pub microsoft_auth: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherConfig {
    #[serde(default = "default_mc_version")]
    pub minecraft_version: String,
    #[serde(default = "default_loader")]
    pub loader: String,
    #[serde(default = "default_loader_version")]
    pub loader_version: String,
    #[serde(default = "default_ram")]
    pub ram: u64,
    #[serde(default)]
    pub nickname: String,
    #[serde(default)]
    pub game_dir: String,
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub java_path: String,
    #[serde(default = "default_java_version")]
    pub java_version: String,
    #[serde(default)]
    pub potato_mode: bool,
    #[serde(default = "default_jvm_profile")]
    pub jvm_profile: String,
    #[serde(default = "default_login_type")]
    pub login_type: String,
    #[serde(default)]
    pub microsoft_auth: Option<Value>,
    #[serde(default)]
    pub pack_version: String,
    #[serde(default)]
    pub target_pack_version: Option<String>,
    #[serde(default)]
    pub last_pack_github_check: Option<u64>,
    #[serde(default)]
    pub disable_auto_update: bool,
    #[serde(default = "default_true")]
    pub auto_update_launcher: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub custom_colors: Option<Value>,
    #[serde(default)]
    pub accounts: Vec<AccountEntry>,
    #[serde(default)]
    pub active_account_index: usize,
    #[serde(default)]
    pub custom_jvm_args: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_mc_version() -> String {
    DEFAULT_MINECRAFT_VERSION.to_string()
}
fn default_loader() -> String {
    DEFAULT_LOADER.to_string()
}
fn default_loader_version() -> String {
    DEFAULT_LOADER_VERSION.to_string()
}
fn default_ram() -> u64 {
    4096
}
fn default_java_version() -> String {
    "auto".to_string()
}
fn default_jvm_profile() -> String {
    "auto".to_string()
}
fn default_login_type() -> String {
    "offline".to_string()
}
fn default_true() -> bool {
    true
}
fn default_theme() -> String {
    "dark-violet".to_string()
}

pub fn default_config_for_system(default_game_dir: &Path, total_ram_mb: u64) -> LauncherConfig {
    let (default_ram, default_profile) = if total_ram_mb <= 4500 {
        (2048, "ultra_potato")
    } else if total_ram_mb <= 8500 {
        (4096, "potato")
    } else if total_ram_mb <= 12500 {
        (6144, "optimized_g1gc")
    } else if total_ram_mb <= 16500 {
        (8192, "optimized_g1gc")
    } else {
        (10240, "extreme_zgc")
    };

    LauncherConfig {
        minecraft_version: default_mc_version(),
        loader: default_loader(),
        loader_version: default_loader_version(),
        ram: default_ram,
        nickname: String::new(),
        game_dir: default_game_dir.to_string_lossy().to_string(),
        github_token: String::new(),
        java_path: String::new(),
        java_version: default_java_version(),
        potato_mode: false,
        jvm_profile: default_profile.to_string(),
        login_type: default_login_type(),
        microsoft_auth: None,
        pack_version: String::new(),
        target_pack_version: None,
        last_pack_github_check: None,
        disable_auto_update: false,
        auto_update_launcher: true,
        theme: default_theme(),
        custom_colors: None,
        accounts: Vec::new(),
        active_account_index: 0,
        custom_jvm_args: String::new(),
        extra: Map::new(),
    }
}

pub fn get_total_ram_mb() -> u64 {
    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()),
    );
    sys.refresh_memory();
    sys.total_memory() / (1024 * 1024)
}

pub struct ActiveGame {
    pub pid: u32,
    pub kill_tx: Option<oneshot::Sender<()>>,
}

pub struct AppState {
    pub app_base_dir: PathBuf,
    pub config_path: PathBuf,
    pub log_path: PathBuf,
    pub default_game_dir: PathBuf,
    pub is_packaged: bool,
    pub http_client: reqwest::Client,
    pub download_client: reqwest::Client,
    pub config_lock: TokioMutex<()>,
    pub active_game: Arc<StdMutex<Option<ActiveGame>>>,
    pub pending_update_path: Arc<StdMutex<Option<PathBuf>>>,
    pub mod_cache: Arc<ModCacheState>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Self {
        let app_base_dir = resolve_app_base_dir(app);
        let config_path = app_base_dir.join("launcher-config-local.json");
        let log_path = app_base_dir.join("launcher-latest.log");

        migrate_legacy_electron_config(app, &config_path);

        let docs_dir = app
            .path()
            .document_dir()
            .unwrap_or_else(|_| app_base_dir.clone());
        let default_game_dir = docs_dir.join("CiapongiRP").join("minecraft-instance");

        let http_client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(8)
            .build()
            .expect("Nie udało się utworzyć klienta HTTP");

        let download_client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(20))
            .pool_max_idle_per_host(16)
            .build()
            .expect("Nie udało się utworzyć klienta pobierania HTTP");

        Self {
            app_base_dir,
            config_path,
            log_path,
            default_game_dir,
            is_packaged: !cfg!(debug_assertions),
            http_client,
            download_client,
            config_lock: TokioMutex::new(()),
            active_game: Arc::new(StdMutex::new(None)),
            pending_update_path: Arc::new(StdMutex::new(None)),
            mod_cache: Arc::new(ModCacheState::new()),
        }
    }

    pub fn read_config(&self) -> LauncherConfig {
        let total_ram = get_total_ram_mb();
        let fallback = default_config_for_system(&self.default_game_dir, total_ram);

        if self.config_path.exists() {
            match fs::read_to_string(&self.config_path) {
                Ok(raw) => match serde_json::from_str::<LauncherConfig>(&raw) {
                    Ok(mut cfg) => {
                        if cfg.game_dir.trim().is_empty() {
                            cfg.game_dir = self.default_game_dir.to_string_lossy().to_string();
                        }
                        if cfg.ram == 0 {
                            cfg.ram = fallback.ram;
                        }
                        if cfg.accounts.is_empty() && !cfg.nickname.trim().is_empty() {
                            let ms_uuid = cfg
                                .microsoft_auth
                                .as_ref()
                                .and_then(|v| v.get("uuid"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            let acc_id = if cfg.login_type == "microsoft" {
                                ms_uuid.unwrap_or_else(|| format!("offline-{}", cfg.nickname))
                            } else {
                                format!("offline-{}", cfg.nickname)
                            };
                            cfg.accounts.push(AccountEntry {
                                id: acc_id,
                                account_type: cfg.login_type.clone(),
                                nickname: cfg.nickname.clone(),
                                microsoft_auth: cfg.microsoft_auth.clone(),
                            });
                            cfg.active_account_index = 0;
                        }
                        return cfg;
                    }
                    Err(e) => {
                        eprintln!("[Config] Błąd parsowania config.json: {e}");
                    }
                },
                Err(e) => {
                    eprintln!("[Config] Błąd odczytu config.json: {e}");
                }
            }
        }

        fallback
    }

    pub fn write_config(&self, cfg: &LauncherConfig) -> Result<(), String> {
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Nie udało się utworzyć katalogu konfiguracji: {e}"))?;
        }
        let serialized = serde_json::to_string_pretty(cfg)
            .map_err(|e| format!("Błąd serializacji konfiguracji: {e}"))?;
        fs::write(&self.config_path, serialized)
            .map_err(|e| format!("Błąd zapisu konfiguracji: {e}"))
    }

    pub fn log_to_file(&self, message: &str) {
        if let Some(parent) = self.log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            let _ = writeln!(f, "{message}");
        }
    }

    pub fn reset_log_file(&self, header: &str) {
        if let Some(parent) = self.log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&self.log_path, format!("{header}\n"));
    }

    pub fn is_game_running(&self) -> bool {
        self.active_game
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }
}

pub fn resolve_app_base_dir(app: &AppHandle) -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Ok(dir) = std::env::var("PORTABLE_EXECUTABLE_DIR") {
            let trimmed = dir.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                if exe_dir.join("launcher-config-local.json").exists() {
                    return exe_dir.to_path_buf();
                }
            }
        }
    }
    if cfg!(target_os = "linux") {
        if let Ok(appimage) = std::env::var("APPIMAGE") {
            let trimmed = appimage.trim();
            if !trimmed.is_empty() {
                if let Some(parent) = Path::new(trimmed).parent() {
                    return parent.to_path_buf();
                }
            }
        }
    }

    // Zawsze bezpieczne poza katalogiem źródeł (brak pętli reload w `tauri dev`)
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("CiapongiRPLauncher"))
}

pub fn migrate_legacy_config_from_candidates(candidates: &[PathBuf], target_config: &Path) -> bool {
    if target_config.exists() {
        return false;
    }
    for src in candidates {
        if src == target_config || !src.is_file() {
            continue;
        }
        if let Some(parent) = target_config.parent() {
            if fs::create_dir_all(parent).is_err() {
                continue;
            }
        }
        if fs::copy(src, target_config).is_ok() {
            return true;
        }
    }
    false
}

fn migrate_legacy_electron_config(app: &AppHandle, target_config: &Path) {
    if target_config.exists() {
        return;
    }
    let mut candidates = Vec::new();
    if let Ok(cfg_root) = app.path().config_dir() {
        candidates.push(cfg_root.join("ciapongi-rp-launcher").join("launcher-config-local.json"));
        candidates.push(cfg_root.join("CiapongiRPLauncher").join("launcher-config-local.json"));
    }
    if let Ok(data_root) = app.path().data_dir() {
        candidates.push(data_root.join("ciapongi-rp-launcher").join("launcher-config-local.json"));
        candidates.push(data_root.join("CiapongiRPLauncher").join("launcher-config-local.json"));
    }
    let _ = migrate_legacy_config_from_candidates(&candidates, target_config);
}

pub fn emit_status(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit("status-message", message.into());
}

#[derive(Debug, Clone)]
pub struct DownloadProgressInfo {
    pub progress: u8,
    pub transferred: u64,
    pub total: u64,
    pub speed: f64,
}

pub async fn download_file_stream<F>(
    client: &reqwest::Client,
    url: &str,
    dest_path: &Path,
    mut on_progress: Option<F>,
) -> Result<(), String>
where
    F: FnMut(DownloadProgressInfo),
{
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Błąd tworzenia katalogu {}: {e}", parent.display()))?;
    }

    let tmp_path = dest_path.with_extension(format!(
        "{}.tmp",
        dest_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("part")
    ));

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Błąd połączenia ({url}): {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} dla {url}", resp.status().as_u16()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut file =
        File::create(&tmp_path).map_err(|e| format!("Błąd zapisu {}: {e}", tmp_path.display()))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let start_time = Instant::now();
    let mut last_tick = start_time;
    let mut last_bytes: u64 = 0;
    let mut current_speed: f64 = 0.0;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("Błąd strumienia pobierania ({url}): {e}")
        })?;
        file.write_all(&chunk).map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("Błąd zapisu dysku ({}): {e}", tmp_path.display())
        })?;

        downloaded += chunk.len() as u64;
        let elapsed_since_tick = last_tick.elapsed();
        if elapsed_since_tick >= Duration::from_millis(200) {
            let secs = elapsed_since_tick.as_secs_f64();
            if secs > 0.0 {
                current_speed = (downloaded.saturating_sub(last_bytes)) as f64 / secs;
            }
            last_tick = Instant::now();
            last_bytes = downloaded;

            if let Some(cb) = on_progress.as_mut() {
                let progress = if total > 0 {
                    ((downloaded as f64 / total as f64) * 100.0)
                        .round()
                        .min(100.0) as u8
                } else {
                    0
                };
                let speed = if current_speed > 0.0 {
                    current_speed
                } else {
                    downloaded as f64 / start_time.elapsed().as_secs_f64().max(0.001)
                };
                cb(DownloadProgressInfo {
                    progress,
                    transferred: downloaded,
                    total,
                    speed,
                });
            }
        }
    }

    file.flush().map_err(|e| format!("Błąd flush pliku: {e}"))?;
    drop(file);

    if let Some(cb) = on_progress.as_mut() {
        let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
        cb(DownloadProgressInfo {
            progress: 100,
            transferred: downloaded,
            total: total.max(downloaded),
            speed: downloaded as f64 / elapsed,
        });
    }

    if dest_path.exists() {
        let _ = fs::remove_file(dest_path);
    }
    fs::rename(&tmp_path, dest_path)
        .map_err(|e| format!("Błąd finalizacji pliku {}: {e}", dest_path.display()))?;

    Ok(())
}

pub fn compare_semver(remote_tag: &str, local_version: &str) -> std::cmp::Ordering {
    fn parse_nums(v: &str) -> Vec<u64> {
        let core = v.trim().trim_start_matches('v').split('-').next().unwrap_or("");
        core.split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    }

    let r = parse_nums(remote_tag);
    let l = parse_nums(local_version);
    let max_len = r.len().max(l.len()).max(3);

    for i in 0..max_len {
        let rv = *r.get(i).unwrap_or(&0);
        let lv = *l.get(i).unwrap_or(&0);
        if rv != lv {
            return rv.cmp(&lv);
        }
    }
    std::cmp::Ordering::Equal
}

pub fn is_newer_version(remote_tag: &str, local_version: &str) -> bool {
    if remote_tag.trim().is_empty() || local_version.trim().is_empty() {
        return false;
    }
    compare_semver(remote_tag, local_version) == std::cmp::Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrate_legacy_config_copies_only_when_missing() {
        let base = std::env::temp_dir().join(format!("ciapongi-state-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let src_dir = base.join("legacy/ciapongi-rp-launcher");
        let dst_dir = base.join("tauri/com.ciapongirp.launcher");
        fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("launcher-config-local.json");
        let dst = dst_dir.join("launcher-config-local.json");
        fs::write(&src, r#"{"nickname":"Mati","ram":8192}"#).unwrap();

        assert!(migrate_legacy_config_from_candidates(&[src.clone()], &dst));
        assert_eq!(fs::read_to_string(&dst).unwrap(), r#"{"nickname":"Mati","ram":8192}"#);

        // Gdy plik docelowy już istnieje, nie nadpisuje go
        fs::write(&dst, r#"{"nickname":"Nowy"}"#).unwrap();
        assert!(!migrate_legacy_config_from_candidates(&[src], &dst));
        assert_eq!(fs::read_to_string(&dst).unwrap(), r#"{"nickname":"Nowy"}"#);

        let _ = fs::remove_dir_all(&base);
    }
}


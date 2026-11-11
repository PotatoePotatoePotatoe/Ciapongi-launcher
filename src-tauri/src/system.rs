use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

use crate::state::{AccountEntry, AppState, LauncherConfig};

#[derive(Debug, Serialize)]
pub struct SystemSpecs {
    pub cpu: String,
    pub cores: usize,
    pub ram: u64,
    pub gpu: String,
}

#[derive(Debug, Serialize)]
pub struct PlayersStatus {
    pub online: u64,
    pub max: u64,
}

#[derive(Debug, Serialize)]
pub struct ServerStatusResponse {
    pub online: bool,
    pub players: PlayersStatus,
    pub version: String,
    pub motd: String,
}

#[derive(Debug, Serialize)]
pub struct ScreenshotItem {
    pub filename: String,
    pub path: String,
    pub created: u64,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAccountInput {
    #[serde(rename = "type")]
    pub account_type: String,
    pub nickname: String,
    #[serde(default)]
    pub microsoft_auth: Option<Value>,
}

fn open_path_in_os(target: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Nie udało się otworzyć folderu w Eksploratorze: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Nie udało się otworzyć folderu w Finderze: {e}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Nie udało się otworzyć ścieżki przez xdg-open: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
pub fn window_maximize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        } else {
            let _ = win.maximize();
        }
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<LauncherConfig, String> {
    let _guard = state.config_lock.lock().await;
    Ok(state.read_config())
}

#[tauri::command]
pub async fn save_config(state: State<'_, AppState>, config: LauncherConfig) -> Result<Value, String> {
    let _guard = state.config_lock.lock().await;
    state.write_config(&config)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn get_system_ram() -> u64 {
    crate::state::get_total_ram_mb()
}

#[tauri::command]
pub async fn get_system_specs() -> SystemSpecs {
    tokio::task::spawn_blocking(|| {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        sys.refresh_cpu_all();
        sys.refresh_memory();

        let cpus = sys.cpus();
        let cpu_model = cpus
            .first()
            .map(|c| c.brand().trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Nieznany procesor".to_string());
        let cpu_cores = cpus.len().max(1);
        let total_ram_mb = sys.total_memory() / (1024 * 1024);
        let gpu = detect_gpu_name();

        SystemSpecs {
            cpu: cpu_model,
            cores: cpu_cores,
            ram: total_ram_mb,
            gpu,
        }
    })
    .await
    .unwrap_or(SystemSpecs {
        cpu: "Nieznany procesor".to_string(),
        cores: 1,
        ram: 4096,
        gpu: "Nieznana karta graficzna".to_string(),
    })
}

fn detect_gpu_name() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        ])
        .creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output()
        {
            let txt = String::from_utf8_lossy(&output.stdout);
            if let Some(last) = txt.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).last() {
                return last.to_string();
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("lspci").output() {
            let txt = String::from_utf8_lossy(&output.stdout);
            for line in txt.lines() {
                let lower = line.to_ascii_lowercase();
                if lower.contains("vga") || lower.contains("3d") || lower.contains("display") {
                    let parts: Vec<&str> = line.split(':').collect();
                    if parts.len() > 2 {
                        return parts[2..].join(":").trim().to_string();
                    }
                    return line.trim().to_string();
                }
            }
        }
    }

    "Nieznana karta graficzna".to_string()
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<ServerStatusResponse, String> {
    let default_resp = ServerStatusResponse {
        online: false,
        players: PlayersStatus { online: 0, max: 100 },
        version: "Fabric 1.20.1".to_string(),
        motd: String::new(),
    };

    let res = state
        .http_client
        .get("https://api.mcsrvstat.us/3/ciapongi.szablix.pl")
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await;

    let Ok(resp) = res else {
        return Ok(default_resp);
    };
    let Ok(data) = resp.json::<Value>().await else {
        return Ok(default_resp);
    };

    let online = data.get("online").and_then(|v| v.as_bool()).unwrap_or(false);
    let players_online = data
        .get("players")
        .and_then(|p| p.get("online"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let players_max = data
        .get("players")
        .and_then(|p| p.get("max"))
        .and_then(|v| v.as_u64())
        .unwrap_or(100);
    let version = data
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("Fabric 1.20.1")
        .to_string();
    let motd = data
        .get("motd")
        .and_then(|m| m.get("clean"))
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| "Ciapongi RP".to_string());

    Ok(ServerStatusResponse {
        online,
        players: PlayersStatus {
            online: players_online,
            max: players_max,
        },
        version,
        motd,
    })
}

#[tauri::command]
pub async fn open_folder(state: State<'_, AppState>, subfolder: String) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let base = PathBuf::from(&cfg.game_dir);
    let target = match subfolder.as_str() {
        "mods" => base.join("mods"),
        "saves" => base.join("saves"),
        "screenshots" => base.join("screenshots"),
        "shaderpacks" | "shaders" | "shader" => base.join("shaderpacks"),
        "resourcepacks" => base.join("resourcepacks"),
        _ => base,
    };

    if !target.exists() {
        if let Err(e) = fs::create_dir_all(&target) {
            return Ok(json!({ "success": false, "error": e.to_string() }));
        }
    }

    match open_path_in_os(&target) {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "error": e })),
    }
}

#[tauri::command]
pub async fn open_logs(state: State<'_, AppState>) -> Result<Value, String> {
    if !state.log_path.exists() {
        return Ok(json!({ "success": false, "error": "Brak pliku logów." }));
    }
    match open_path_in_os(&state.log_path) {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "error": e })),
    }
}

#[tauri::command]
pub async fn select_directory(app: AppHandle) -> Option<String> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .set_title("Wybierz folder instalacyjny gry")
        .pick_folder(move |folder_opt| {
            let path_str = folder_opt.map(|fp| {
                let fallback = fp.to_string();
                fp.into_path()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or(fallback)
            });
            let _ = tx.send(path_str);
        });

    rx.await.ok().flatten()
}

pub fn build_servers_dat_nbt(server_name: &str, server_ip: &str) -> Vec<u8> {
    fn write_nbt_string(out: &mut Vec<u8>, s: &str) {
        let bytes = s.as_bytes();
        out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        out.extend_from_slice(bytes);
    }

    let mut server_compound = Vec::new();
    // TAG_String (8) "name"
    server_compound.push(8);
    write_nbt_string(&mut server_compound, "name");
    write_nbt_string(&mut server_compound, server_name);

    // TAG_String (8) "ip"
    server_compound.push(8);
    write_nbt_string(&mut server_compound, "ip");
    write_nbt_string(&mut server_compound, server_ip);

    // TAG_Byte (1) "hideAddress" = 0
    server_compound.push(1);
    write_nbt_string(&mut server_compound, "hideAddress");
    server_compound.push(0);

    // TAG_End (0)
    server_compound.push(0);

    // TAG_List (9) "servers": element type TAG_Compound (10), len 1
    let mut root_compound = Vec::new();
    root_compound.push(9);
    write_nbt_string(&mut root_compound, "servers");
    root_compound.push(10);
    root_compound.extend_from_slice(&(1i32).to_be_bytes());
    root_compound.extend_from_slice(&server_compound);
    root_compound.push(0); // TAG_End root compound

    // Uncompressed NBT root TAG_Compound (10) + empty name ("")
    let mut header = vec![10, 0, 0];
    header.extend_from_slice(&root_compound);
    header
}

#[tauri::command]
pub async fn add_server_to_minecraft(state: State<'_, AppState>) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    if !game_dir.exists() {
        if let Err(e) = fs::create_dir_all(&game_dir) {
            return Ok(json!({ "success": false, "error": e.to_string() }));
        }
    }

    let servers_dat = game_dir.join("servers.dat");
    let server_ip = "ciapongi.szablix.pl";
    let server_name = "Ciapongi-RP";

    if servers_dat.exists() {
        if let Ok(existing) = fs::read(&servers_dat) {
            if existing
                .windows(server_ip.len())
                .any(|w| w == server_ip.as_bytes())
            {
                state.log_to_file(
                    "[SYSTEM] Serwer Ciapongi-RP już istnieje w servers.dat — pomijanie zapisu.",
                );
                return Ok(json!({ "success": true, "alreadyExists": true }));
            }
        }
    }

    let nbt_bytes = build_servers_dat_nbt(server_name, server_ip);
    match fs::write(&servers_dat, nbt_bytes) {
        Ok(()) => {
            state.log_to_file(&format!(
                "[SYSTEM] Zapisano servers.dat z serwerem {server_ip}"
            ));
            Ok(json!({ "success": true }))
        }
        Err(e) => Ok(json!({ "success": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn add_account(
    state: State<'_, AppState>,
    data: AddAccountInput,
) -> Result<Value, String> {
    let _guard = state.config_lock.lock().await;
    let mut cfg = state.read_config();

    let id = if data.account_type == "microsoft" {
        data.microsoft_auth
            .as_ref()
            .and_then(|v| v.get("uuid"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("offline-{}", data.nickname))
    } else {
        format!("offline-{}", data.nickname)
    };

    let new_account = AccountEntry {
        id: id.clone(),
        account_type: data.account_type.clone(),
        nickname: data.nickname.clone(),
        microsoft_auth: data.microsoft_auth.clone(),
    };

    if let Some(pos) = cfg.accounts.iter().position(|a| a.id == id) {
        cfg.accounts[pos] = new_account.clone();
        cfg.active_account_index = pos;
    } else {
        cfg.accounts.push(new_account.clone());
        cfg.active_account_index = cfg.accounts.len() - 1;
    }

    cfg.nickname = new_account.nickname;
    cfg.login_type = new_account.account_type;
    cfg.microsoft_auth = new_account.microsoft_auth;

    if let Err(e) = state.write_config(&cfg) {
        return Ok(json!({ "success": false, "error": e }));
    }
    Ok(json!({ "success": true, "config": cfg }))
}

#[tauri::command]
pub async fn switch_account(state: State<'_, AppState>, index: usize) -> Result<Value, String> {
    let _guard = state.config_lock.lock().await;
    let mut cfg = state.read_config();
    if index >= cfg.accounts.len() {
        return Ok(json!({ "success": false, "error": "Nieprawidłowy indeks konta." }));
    }
    cfg.active_account_index = index;
    let acc = cfg.accounts[index].clone();
    cfg.nickname = acc.nickname;
    cfg.login_type = acc.account_type;
    cfg.microsoft_auth = acc.microsoft_auth;

    if let Err(e) = state.write_config(&cfg) {
        return Ok(json!({ "success": false, "error": e }));
    }
    Ok(json!({ "success": true, "config": cfg }))
}

#[tauri::command]
pub async fn remove_account(state: State<'_, AppState>, index: usize) -> Result<Value, String> {
    let _guard = state.config_lock.lock().await;
    let mut cfg = state.read_config();
    if index >= cfg.accounts.len() {
        return Ok(json!({ "success": false, "error": "Nieprawidłowy indeks konta." }));
    }

    cfg.accounts.remove(index);

    if cfg.accounts.is_empty() {
        cfg.active_account_index = 0;
        cfg.nickname = "Gracz".to_string();
        cfg.login_type = "offline".to_string();
        cfg.microsoft_auth = None;
    } else {
        if index == cfg.active_account_index || cfg.active_account_index >= cfg.accounts.len() {
            cfg.active_account_index = 0;
        } else if index < cfg.active_account_index {
            cfg.active_account_index -= 1;
        }
        let acc = cfg.accounts[cfg.active_account_index].clone();
        cfg.nickname = acc.nickname;
        cfg.login_type = acc.account_type;
        cfg.microsoft_auth = acc.microsoft_auth;
    }

    if let Err(e) = state.write_config(&cfg) {
        return Ok(json!({ "success": false, "error": e }));
    }
    Ok(json!({ "success": true, "config": cfg }))
}

#[tauri::command]
pub async fn get_screenshots(state: State<'_, AppState>) -> Result<Vec<ScreenshotItem>, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let screenshots_dir = PathBuf::from(&cfg.game_dir).join("screenshots");
    if !screenshots_dir.exists() {
        return Ok(Vec::new());
    }

    let items = tokio::task::spawn_blocking(move || {
        let mut items = Vec::new();
        let Ok(entries) = fs::read_dir(&screenshots_dir) else {
            return items;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_ascii_lowercase();
            if !(lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")) {
                continue;
            }

            if let Ok(meta) = entry.metadata() {
                let timestamp = meta
                    .created()
                    .or_else(|_| meta.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);

                items.push(ScreenshotItem {
                    filename: name,
                    path: path.to_string_lossy().to_string(),
                    created: timestamp,
                    size: meta.len(),
                });
            }
        }

        items.sort_by(|a, b| b.created.cmp(&a.created));
        items
    })
    .await
    .unwrap_or_default();

    Ok(items)
}

#[tauri::command]
pub async fn delete_screenshot(
    state: State<'_, AppState>,
    filename: String,
) -> Result<Value, String> {
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
    {
        return Ok(json!({ "success": false, "error": "Nieprawidłowa nazwa pliku." }));
    }

    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let file_path = PathBuf::from(&cfg.game_dir)
        .join("screenshots")
        .join(&filename);
    if !file_path.exists() {
        return Ok(json!({ "success": false, "error": "Plik nie istnieje." }));
    }

    match fs::remove_file(&file_path) {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "error": e.to_string() })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_servers_dat_nbt_valid_structure() {
        let nbt = build_servers_dat_nbt("Ciapongi-RP", "ciapongi.szablix.pl");
        assert_eq!(nbt[0], 10); // Root TAG_Compound
        assert_eq!(&nbt[1..3], &[0, 0]); // Empty root name
        assert!(nbt
            .windows("Ciapongi-RP".len())
            .any(|w| w == b"Ciapongi-RP"));
        assert!(nbt
            .windows("ciapongi.szablix.pl".len())
            .any(|w| w == b"ciapongi.szablix.pl"));
        assert_eq!(*nbt.last().unwrap(), 0); // Root TAG_End
    }
}

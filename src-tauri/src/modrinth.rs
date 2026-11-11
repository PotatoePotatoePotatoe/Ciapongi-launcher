use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use flate2::read::DeflateDecoder;
use futures_util::future::BoxFuture;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use tauri::{AppHandle, State};
use tokio::sync::broadcast;
use zip::ZipArchive;

use crate::state::{download_file_stream, emit_status, AppState};

const SEARCH_CACHE_TTL: Duration = Duration::from_secs(60);
const MAX_SEARCH_CACHE: usize = 60;
const MAX_JAR_CACHE: usize = 2000;

const EOCD_SIG: u32 = 0x0605_4b50;
const CD_SIG: u32 = 0x0201_4b50;
const LH_SIG: u32 = 0x0403_4b50;
const TARGET_MOD_JSON: &[u8] = b"fabric.mod.json";
const MAX_ENTRY_COMPRESSED_SIZE: usize = 5 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_SIZE: usize = 8 * 1024 * 1024;
const MAX_CD_SIZE: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModJarMeta {
    pub id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedJarEntry {
    mtime_ms: u128,
    size: u64,
    meta: Option<ModJarMeta>,
}

#[derive(Debug, Clone)]
struct CachedPackSet {
    key: String,
    ids: HashSet<String>,
}

#[derive(Debug, Clone)]
struct CachedSearchEntry {
    created_at: Instant,
    results: Vec<ModrinthSearchHit>,
}

pub struct ModCacheState {
    jar_meta_cache: StdMutex<HashMap<PathBuf, CachedJarEntry>>,
    pack_cache: StdMutex<Option<CachedPackSet>>,
    search_cache: StdMutex<HashMap<String, CachedSearchEntry>>,
    in_flight_searches: StdMutex<HashMap<String, broadcast::Sender<Vec<ModrinthSearchHit>>>>,
}

impl ModCacheState {
    pub fn new() -> Self {
        Self {
            jar_meta_cache: StdMutex::new(HashMap::new()),
            pack_cache: StdMutex::new(None),
            search_cache: StdMutex::new(HashMap::new()),
            in_flight_searches: StdMutex::new(HashMap::new()),
        }
    }

    pub fn invalidate_pack_cache(&self) {
        if let Ok(mut pack) = self.pack_cache.lock() {
            *pack = None;
        }
        if let Ok(mut search) = self.search_cache.lock() {
            search.clear();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchHit {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(rename = "icon_url")]
    pub icon_url: Option<String>,
    pub author: String,
    pub slug: String,
    #[serde(rename = "inMainPack")]
    pub in_main_pack: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProjectItem {
    pub id: String,
    pub filename: String,
    pub title: String,
    #[serde(rename = "icon_url")]
    pub icon_url: Option<String>,
    pub enabled: bool,
    #[serde(rename = "type")]
    pub project_type: String,
    #[serde(rename = "isPackMod", skip_serializing_if = "Option::is_none")]
    pub is_pack_mod: Option<bool>,
    #[serde(rename = "isLocal", skip_serializing_if = "Option::is_none")]
    pub is_local: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdateInfo {
    pub old_filename: String,
    pub title: String,
    #[serde(rename = "icon_url")]
    pub icon_url: Option<String>,
    pub project_id: String,
    pub new_filename: String,
    pub new_version: String,
    pub version_type: String,
    pub download_url: String,
    pub changelog: String,
    pub date_published: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModVersionOption {
    pub id: String,
    pub name: String,
    pub version_number: String,
    pub version_type: String,
    pub date_published: Option<String>,
    pub changelog: String,
    pub filename: Option<String>,
    pub download_url: Option<String>,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModInput {
    pub old_filename: String,
    pub new_filename: String,
    pub download_url: String,
}

pub fn clean_id(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

enum DirectZipLookup {
    Found(Option<ModJarMeta>),
    Fallback,
}

#[inline]
fn le_u16(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([buf[off], buf[off + 1]])
}

#[inline]
fn le_u32(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

fn parse_fabric_mod_json_bytes(raw_bytes: &[u8]) -> Option<ModJarMeta> {
    let raw_str = std::str::from_utf8(raw_bytes).ok()?;
    let cleaned = raw_str.trim_start_matches('\u{feff}');
    let parsed: Value = serde_json::from_str(cleaned).ok()?;

    let id = parsed
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let name = parsed
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(ModJarMeta { id, name })
}

fn read_fabric_mod_json_direct(file: &mut File, file_size: u64) -> DirectZipLookup {
    if file_size < 22 {
        return DirectZipLookup::Found(None);
    }

    let tail_size = file_size.min(65557) as usize;
    let tail_offset = file_size - tail_size as u64;
    if file.seek(SeekFrom::Start(tail_offset)).is_err() {
        return DirectZipLookup::Fallback;
    }

    let mut tail_buf = vec![0u8; tail_size];
    if file.read_exact(&mut tail_buf).is_err() {
        return DirectZipLookup::Fallback;
    }

    let mut eocd_pos: Option<usize> = None;
    for i in (0..=tail_buf.len() - 22).rev() {
        if le_u32(&tail_buf, i) == EOCD_SIG {
            let comment_len = le_u16(&tail_buf, i + 20) as usize;
            if i + 22 + comment_len == tail_buf.len() {
                eocd_pos = Some(i);
                break;
            }
        }
    }

    let Some(eocd) = eocd_pos else {
        return DirectZipLookup::Fallback;
    };

    let disk_num = le_u16(&tail_buf, eocd + 4);
    let cd_disk = le_u16(&tail_buf, eocd + 6);
    let cd_size_u32 = le_u32(&tail_buf, eocd + 12);
    let cd_offset_u32 = le_u32(&tail_buf, eocd + 16);

    if disk_num != 0
        || cd_disk != 0
        || cd_size_u32 == u32::MAX
        || cd_offset_u32 == u32::MAX
    {
        return DirectZipLookup::Fallback;
    }

    let cd_size = cd_size_u32 as usize;
    let cd_offset = cd_offset_u32 as u64;
    let Some(cd_end) = cd_offset.checked_add(cd_size as u64) else {
        return DirectZipLookup::Fallback;
    };
    if cd_size > MAX_CD_SIZE || cd_end > file_size {
        return DirectZipLookup::Fallback;
    }

    let owned_cd: Vec<u8>;
    let cd_slice: &[u8] = if cd_offset >= tail_offset {
        let rel_start = (cd_offset - tail_offset) as usize;
        &tail_buf[rel_start..rel_start + cd_size]
    } else {
        if file.seek(SeekFrom::Start(cd_offset)).is_err() {
            return DirectZipLookup::Fallback;
        }
        let mut buf = vec![0u8; cd_size];
        if file.read_exact(&mut buf).is_err() {
            return DirectZipLookup::Fallback;
        }
        owned_cd = buf;
        &owned_cd
    };

    let mut pos = 0usize;
    while pos + 46 <= cd_slice.len() {
        if le_u32(cd_slice, pos) != CD_SIG {
            return DirectZipLookup::Fallback;
        }

        let flags = le_u16(cd_slice, pos + 8);
        let method = le_u16(cd_slice, pos + 10);
        let comp_size_u32 = le_u32(cd_slice, pos + 20);
        let uncomp_size_u32 = le_u32(cd_slice, pos + 24);
        let name_len = le_u16(cd_slice, pos + 28) as usize;
        let extra_len = le_u16(cd_slice, pos + 30) as usize;
        let comment_len = le_u16(cd_slice, pos + 32) as usize;
        let local_hdr_offset_u32 = le_u32(cd_slice, pos + 42);

        let Some(next_pos) = pos
            .checked_add(46)
            .and_then(|v| v.checked_add(name_len))
            .and_then(|v| v.checked_add(extra_len))
            .and_then(|v| v.checked_add(comment_len))
        else {
            return DirectZipLookup::Fallback;
        };
        if next_pos > cd_slice.len() {
            return DirectZipLookup::Fallback;
        }

        if name_len == TARGET_MOD_JSON.len()
            && &cd_slice[pos + 46..pos + 46 + name_len] == TARGET_MOD_JSON
        {
            if (flags & 0x0001) != 0
                || comp_size_u32 == u32::MAX
                || uncomp_size_u32 == u32::MAX
                || local_hdr_offset_u32 == u32::MAX
            {
                return DirectZipLookup::Fallback;
            }

            let comp_size = comp_size_u32 as usize;
            let uncomp_size = uncomp_size_u32 as usize;
            if comp_size > MAX_ENTRY_COMPRESSED_SIZE || uncomp_size > MAX_ENTRY_UNCOMPRESSED_SIZE {
                return DirectZipLookup::Found(None);
            }
            if method != 0 && method != 8 {
                return DirectZipLookup::Fallback;
            }

            let local_offset = local_hdr_offset_u32 as u64;
            if file.seek(SeekFrom::Start(local_offset)).is_err() {
                return DirectZipLookup::Fallback;
            }
            let mut lh = [0u8; 30];
            if file.read_exact(&mut lh).is_err() || le_u32(&lh, 0) != LH_SIG {
                return DirectZipLookup::Fallback;
            }

            let lh_name_len = le_u16(&lh, 26) as u64;
            let lh_extra_len = le_u16(&lh, 28) as u64;
            let Some(data_offset) = local_offset
                .checked_add(30)
                .and_then(|v| v.checked_add(lh_name_len))
                .and_then(|v| v.checked_add(lh_extra_len))
            else {
                return DirectZipLookup::Fallback;
            };
            let Some(data_end) = data_offset.checked_add(comp_size as u64) else {
                return DirectZipLookup::Fallback;
            };
            if data_end > file_size {
                return DirectZipLookup::Fallback;
            }

            if file.seek(SeekFrom::Start(data_offset)).is_err() {
                return DirectZipLookup::Fallback;
            }
            let mut comp_buf = vec![0u8; comp_size];
            if file.read_exact(&mut comp_buf).is_err() {
                return DirectZipLookup::Fallback;
            }

            if method == 0 {
                return DirectZipLookup::Found(parse_fabric_mod_json_bytes(&comp_buf));
            }

            let mut decoder = DeflateDecoder::new(&comp_buf[..])
                .take((MAX_ENTRY_UNCOMPRESSED_SIZE + 1) as u64);
            let mut raw_bytes = Vec::with_capacity(uncomp_size.min(64 * 1024));
            if decoder.read_to_end(&mut raw_bytes).is_err()
                || raw_bytes.len() > MAX_ENTRY_UNCOMPRESSED_SIZE
            {
                return DirectZipLookup::Fallback;
            }
            return DirectZipLookup::Found(parse_fabric_mod_json_bytes(&raw_bytes));
        }

        pos = next_pos;
    }

    if pos != cd_slice.len() {
        return DirectZipLookup::Fallback;
    }

    DirectZipLookup::Found(None)
}

fn read_fabric_mod_json_ziparchive(file: &mut File) -> Option<ModJarMeta> {
    file.seek(SeekFrom::Start(0)).ok()?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader).ok()?;
    let mut entry = archive.by_name("fabric.mod.json").ok()?;

    // Zabezpieczenie przed anomalnie dużym wpisem
    if entry.size() > MAX_ENTRY_UNCOMPRESSED_SIZE as u64 {
        return None;
    }

    let mut raw = String::new();
    entry.read_to_string(&mut raw).ok()?;
    let cleaned = raw.trim_start_matches('\u{feff}');
    let parsed: Value = serde_json::from_str(cleaned).ok()?;

    let id = parsed
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let name = parsed
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(ModJarMeta { id, name })
}

/// Błyskawicznie odczytuje `fabric.mod.json` bezpośrednio z nagłówków EOCD / Central Directory ZIP-a
/// (bez alokowania mapy wpisów dla tysięcy klas wewnątrz `.jar`), z bezpiecznym fallbackiem na `ZipArchive`.
pub fn read_fabric_mod_json(path: &Path) -> Option<ModJarMeta> {
    let mut file = File::open(path).ok()?;
    let file_size = file.metadata().ok()?.len();

    match read_fabric_mod_json_direct(&mut file, file_size) {
        DirectZipLookup::Found(meta) => meta,
        DirectZipLookup::Fallback => read_fabric_mod_json_ziparchive(&mut file),
    }
}

fn file_mtime_and_size(path: &Path) -> Option<(u128, u64)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Some((mtime, meta.len()))
}

pub fn get_jar_mod_metadata(cache: &ModCacheState, path: &Path) -> Option<ModJarMeta> {
    let (mtime_ms, size) = file_mtime_and_size(path)?;

    if let Ok(guard) = cache.jar_meta_cache.lock() {
        if let Some(entry) = guard.get(path) {
            if entry.mtime_ms == mtime_ms && entry.size == size {
                return entry.meta.clone();
            }
        }
    }

    let meta = read_fabric_mod_json(path);

    if let Ok(mut guard) = cache.jar_meta_cache.lock() {
        if guard.len() >= MAX_JAR_CACHE {
            if let Some(oldest) = guard.keys().next().cloned() {
                guard.remove(&oldest);
            }
        }
        guard.insert(
            path.to_path_buf(),
            CachedJarEntry {
                mtime_ms,
                size,
                meta: meta.clone(),
            },
        );
    }

    meta
}

fn get_pack_manifest_stamp(game_dir: &Path) -> String {
    let manifest_path = game_dir.join("pack-manifest.json");
    if let Some((mtime, size)) = file_mtime_and_size(&manifest_path) {
        format!("{}::{mtime}::{size}", game_dir.display())
    } else {
        format!("{}::missing", game_dir.display())
    }
}

pub fn get_main_pack_mod_ids_set(cache: &ModCacheState, game_dir: &Path) -> HashSet<String> {
    let current_key = get_pack_manifest_stamp(game_dir);

    if let Ok(guard) = cache.pack_cache.lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.key == current_key {
                return cached.ids.clone();
            }
        }
    }

    let mut main_mod_ids = HashSet::new();
    let manifest_path = game_dir.join("pack-manifest.json");

    if manifest_path.exists() {
        if let Ok(raw) = fs::read_to_string(&manifest_path) {
            if let Ok(files) = serde_json::from_str::<Vec<String>>(&raw) {
                let mut jar_targets: Vec<(Option<String>, PathBuf)> = Vec::new();

                for file_rel in files {
                    let lower = file_rel.to_ascii_lowercase();
                    if lower.starts_with("mods/")
                        && (lower.ends_with(".jar") || lower.ends_with(".jar.disabled"))
                    {
                        let clean_rel = strip_disabled_suffix(&file_rel);
                        let stem = Path::new(clean_rel)
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .map(clean_id)
                            .filter(|s| !s.is_empty());

                        if let Some(ref s) = stem {
                            main_mod_ids.insert(s.clone());
                        }

                        let standard_path = game_dir.join(clean_rel);
                        let disabled_path = game_dir.join(format!("{clean_rel}.disabled"));
                        let actual_path = if standard_path.exists() {
                            Some(standard_path)
                        } else if disabled_path.exists() {
                            Some(disabled_path)
                        } else {
                            None
                        };

                        if let Some(p) = actual_path {
                            jar_targets.push((stem, p));
                        }
                    }
                }

                // Równoległy odczyt Central Directory + fabric.mod.json w puli wątków Rayon
                let metas: Vec<Option<ModJarMeta>> = jar_targets
                    .par_iter()
                    .map(|(_, path)| get_jar_mod_metadata(cache, path))
                    .collect();

                for meta_opt in metas.into_iter().flatten() {
                    if let Some(id) = meta_opt.id {
                        main_mod_ids.insert(id.to_ascii_lowercase());
                        let cleaned = clean_id(&id);
                        if !cleaned.is_empty() {
                            main_mod_ids.insert(cleaned);
                        }
                    }
                    if let Some(name) = meta_opt.name {
                        let cleaned = clean_id(&name);
                        if !cleaned.is_empty() {
                            main_mod_ids.insert(cleaned);
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut guard) = cache.pack_cache.lock() {
        *guard = Some(CachedPackSet {
            key: current_key,
            ids: main_mod_ids.clone(),
        });
    }

    main_mod_ids
}

fn strip_disabled_suffix(s: &str) -> &str {
    if s.len() >= 9 && s[s.len() - 9..].eq_ignore_ascii_case(".disabled") {
        &s[..s.len() - 9]
    } else {
        s
    }
}

fn ends_with_disabled(s: &str) -> bool {
    s.len() >= 9 && s[s.len() - 9..].eq_ignore_ascii_case(".disabled")
}

pub fn get_folder_for_project_type(game_dir: &Path, project_type: &str) -> PathBuf {
    match project_type {
        "shader" => game_dir.join("shaderpacks"),
        "resourcepack" | "pack-resourcepack" => game_dir.join("resourcepacks"),
        _ => game_dir.join("mods"),
    }
}

#[tauri::command]
pub async fn search_modrinth(
    state: State<'_, AppState>,
    query: String,
    mc_version: String,
    project_type: String,
) -> Result<Vec<ModrinthSearchHit>, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let normalized_query = query.trim().to_string();
    let ptype = if project_type.trim().is_empty() {
        "mod".to_string()
    } else {
        project_type
    };
    let mc_ver = if mc_version.trim().is_empty() {
        cfg.minecraft_version.clone()
    } else {
        mc_version
    };

    let pack_stamp = if ptype == "mod" {
        get_pack_manifest_stamp(&game_dir)
    } else {
        "none".to_string()
    };
    let cache_key = format!(
        "{ptype}::{mc_ver}::{}::{pack_stamp}",
        normalized_query.to_ascii_lowercase()
    );

    if let Ok(cache) = state.mod_cache.search_cache.lock() {
        if let Some(entry) = cache.get(&cache_key) {
            if entry.created_at.elapsed() < SEARCH_CACHE_TTL {
                return Ok(entry.results.clone());
            }
        }
    }

    // Deduplikacja współbieżnych zapytań o ten sam klucz (singleflight)
    let maybe_rx = {
        let mut inflight = state.mod_cache.in_flight_searches.lock().unwrap();
        if let Some(tx) = inflight.get(&cache_key) {
            Some(tx.subscribe())
        } else {
            let (tx, _) = broadcast::channel(1);
            inflight.insert(cache_key.clone(), tx);
            None
        }
    };

    if let Some(mut rx) = maybe_rx {
        if let Ok(results) = rx.recv().await {
            return Ok(results);
        }
    }

    let search_res = execute_modrinth_search_uncached(
        &state.http_client,
        state.mod_cache.clone(),
        game_dir,
        &normalized_query,
        &mc_ver,
        &ptype,
    )
    .await;

    let results = match search_res {
        Ok(hits) => {
            if let Ok(mut cache) = state.mod_cache.search_cache.lock() {
                if cache.len() >= MAX_SEARCH_CACHE {
                    cache.retain(|_, v| v.created_at.elapsed() < SEARCH_CACHE_TTL);
                }
                if cache.len() >= MAX_SEARCH_CACHE {
                    if let Some(oldest_key) = cache.keys().next().cloned() {
                        cache.remove(&oldest_key);
                    }
                }
                cache.insert(
                    cache_key.clone(),
                    CachedSearchEntry {
                        created_at: Instant::now(),
                        results: hits.clone(),
                    },
                );
            }
            hits
        }
        Err(_) => Vec::new(),
    };

    if let Ok(mut inflight) = state.mod_cache.in_flight_searches.lock() {
        if let Some(tx) = inflight.remove(&cache_key) {
            let _ = tx.send(results.clone());
        }
    }

    Ok(results)
}

pub async fn execute_modrinth_search_uncached(
    client: &reqwest::Client,
    mod_cache: std::sync::Arc<ModCacheState>,
    game_dir: PathBuf,
    query: &str,
    mc_version: &str,
    project_type: &str,
) -> Result<Vec<ModrinthSearchHit>, String> {
    let mut facets: Vec<Vec<String>> = Vec::new();
    if project_type == "mod" {
        facets.push(vec!["categories:fabric".to_string()]);
    }
    if !mc_version.is_empty() {
        facets.push(vec![format!("versions:{mc_version}")]);
    }
    facets.push(vec![format!("project_type:{project_type}")]);

    let facets_json = serde_json::to_string(&facets).unwrap_or_else(|_| "[]".to_string());
    let req_fut = client
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("query", query),
            ("facets", facets_json.as_str()),
            ("limit", "20"),
        ])
        .timeout(Duration::from_secs(8))
        .send();

    let need_pack_set = project_type == "mod";
    let pack_fut = tokio::task::spawn_blocking(move || {
        if need_pack_set {
            Some(get_main_pack_mod_ids_set(&mod_cache, &game_dir))
        } else {
            None
        }
    });

    let (api_res, pack_res) = tokio::join!(req_fut, pack_fut);
    let main_pack_set = pack_res.unwrap_or(None);

    let resp = api_res.map_err(|e| format!("Błąd połączenia z Modrinth API: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Modrinth API HTTP {}", resp.status().as_u16()));
    }
    let data = resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Błąd parsowania JSON z Modrinth API: {e}"))?;

    let Some(hits) = data.get("hits").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };

    Ok(hits
        .iter()
        .filter_map(|hit| {
            let id = hit.get("project_id")?.as_str()?.to_string();
            let title = hit
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string();
            let description = hit
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let icon_url = hit
                .get("icon_url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let author = hit
                .get("author")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let slug = hit
                .get("slug")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string();

            let in_main_pack = if let Some(ref set) = main_pack_set {
                let slug_c = clean_id(&slug);
                let title_c = clean_id(&title);
                let id_c = clean_id(&id);
                (!slug_c.is_empty() && set.contains(&slug_c))
                    || (!title_c.is_empty() && set.contains(&title_c))
                    || (!id_c.is_empty() && set.contains(&id_c))
            } else {
                false
            };

            Some(ModrinthSearchHit {
                id,
                title,
                description,
                icon_url,
                author,
                slug,
                in_main_pack,
            })
        })
        .collect())
}

fn install_modrinth_project_internal<'a>(
    app: &'a AppHandle,
    state: &'a AppState,
    project_id: String,
    project_type: String,
    cfg: &'a crate::state::LauncherConfig,
    game_dir: &'a Path,
    installed_set: &'a mut HashSet<String>,
) -> BoxFuture<'a, Result<String, String>> {
    Box::pin(async move {
        if installed_set.contains(&project_id) {
            return Ok(project_id);
        }
        installed_set.insert(project_id.clone());

        let target_dir = get_folder_for_project_type(game_dir, &project_type);
        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Nie udało się utworzyć katalogu {}: {e}", target_dir.display()))?;

        let mut canonical_id = project_id.clone();
        let mut title = project_id.clone();
        let mut real_slug = clean_id(&project_id);
        let mut real_title = real_slug.clone();
        let mut icon_url: Option<String> = None;

        if let Ok(resp) = state
            .http_client
            .get(format!("https://api.modrinth.com/v2/project/{project_id}"))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(info) = resp.json::<Value>().await {
                    if let Some(pid) = info.get("id").and_then(|v| v.as_str()) {
                        canonical_id = pid.to_string();
                        installed_set.insert(canonical_id.clone());
                    }
                    if let Some(t) = info.get("title").and_then(|v| v.as_str()) {
                        title = t.to_string();
                        real_title = clean_id(t);
                    }
                    if let Some(s) = info.get("slug").and_then(|v| v.as_str()) {
                        real_slug = clean_id(s);
                    }
                    icon_url = info
                        .get("icon_url")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }

        let target_loader = if cfg.loader.is_empty() {
            "fabric"
        } else {
            cfg.loader.as_str()
        };
        let target_mc = if cfg.minecraft_version.is_empty() {
            "1.20.1"
        } else {
            cfg.minecraft_version.as_str()
        };

        let mut target_version: Option<Value> = None;
        if let Ok(resp) = state
            .http_client
            .get(format!(
                "https://api.modrinth.com/v2/project/{canonical_id}/version"
            ))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(all_versions) = resp.json::<Vec<Value>>().await {
                    let mut compatible: Vec<Value> = if project_type == "mod" {
                        all_versions
                            .iter()
                            .filter(|v| {
                                let has_mc = v
                                    .get("game_versions")
                                    .and_then(|g| g.as_array())
                                    .map(|a| a.iter().any(|x| x.as_str() == Some(target_mc)))
                                    .unwrap_or(false);
                                let has_loader = v
                                    .get("loaders")
                                    .and_then(|l| l.as_array())
                                    .map(|a| a.iter().any(|x| x.as_str() == Some(target_loader)))
                                    .unwrap_or(false);
                                has_mc && has_loader
                            })
                            .cloned()
                            .collect()
                    } else {
                        let mc_filtered: Vec<Value> = all_versions
                            .iter()
                            .filter(|v| {
                                v.get("game_versions")
                                    .and_then(|g| g.as_array())
                                    .map(|a| a.iter().any(|x| x.as_str() == Some(target_mc)))
                                    .unwrap_or(false)
                            })
                            .cloned()
                            .collect();
                        if mc_filtered.is_empty() {
                            all_versions.clone()
                        } else {
                            mc_filtered
                        }
                    };

                    if compatible.is_empty() {
                        if project_type == "mod" {
                            compatible = all_versions
                                .iter()
                                .filter(|v| {
                                    v.get("loaders")
                                        .and_then(|l| l.as_array())
                                        .map(|a| a.iter().any(|x| x.as_str() == Some(target_loader)))
                                        .unwrap_or(false)
                                })
                                .cloned()
                                .collect();
                        }
                        if compatible.is_empty() {
                            compatible = all_versions;
                        }
                    }

                    if !compatible.is_empty() {
                        let release_ver = compatible.iter().find(|v| {
                            v.get("version_type").and_then(|x| x.as_str()) == Some("release")
                        });
                        target_version = release_ver.cloned().or_else(|| compatible.into_iter().next());
                    }
                }
            }
        }

        let existing_files: Vec<String> = fs::read_dir(&target_dir)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default();

        let match_file = existing_files.into_iter().find(|f| {
            let clean_f = clean_id(f);
            (real_slug.len() > 2 && clean_f.contains(&real_slug))
                || (real_title.len() > 3 && clean_f.contains(&real_title))
        });

        let mut file_already_present = false;
        if let Some(matched) = match_file {
            let full_path = target_dir.join(&matched);
            if ends_with_disabled(&matched) {
                let enabled_name = strip_disabled_suffix(&matched);
                let enabled_path = target_dir.join(enabled_name);
                fs::rename(&full_path, &enabled_path)
                    .map_err(|e| format!("Błąd włączania istniejącego pliku: {e}"))?;
                emit_status(app, format!("Włączono istniejący plik: {enabled_name}"));
            } else if matched.to_ascii_lowercase().ends_with(".jar")
                || matched.to_ascii_lowercase().ends_with(".zip")
            {
                emit_status(app, format!("Mod jest już zainstalowany: {matched}"));
            }
            file_already_present = true;
        }

        if !file_already_present {
            let Some(ref ver) = target_version else {
                return Err(format!("Nie odnaleziono kompatybilnej wersji dla {title}"));
            };
            let files = ver
                .get("files")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "Brak listy plików projektu.".to_string())?;
            let primary_file = files
                .iter()
                .find(|f| f.get("primary").and_then(|v| v.as_bool()) == Some(true))
                .or_else(|| files.first())
                .ok_or_else(|| "Nie znaleziono pliku projektu.".to_string())?;

            let file_name = primary_file
                .get("filename")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Brak nazwy pliku projektu.".to_string())?
                .to_string();
            let file_url = primary_file
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Brak adresu URL pliku projektu.".to_string())?;

            emit_status(app, format!("Pobieranie: {file_name}..."));
            let temp_path = game_dir.join(format!("temp_{file_name}"));
            download_file_stream::<fn(_)>(
                &state.download_client,
                file_url,
                &temp_path,
                None,
            )
            .await?;

            if project_type == "mod" {
                let meta = get_jar_mod_metadata(&state.mod_cache, &temp_path);
                if let Some(internal_id) = meta.and_then(|m| m.id) {
                    let main_pack_set = get_main_pack_mod_ids_set(&state.mod_cache, game_dir);
                    if main_pack_set.contains(&internal_id.to_ascii_lowercase()) {
                        let _ = fs::remove_file(&temp_path);
                        return Ok(title);
                    }
                }
            }

            let dest_path = target_dir.join(&file_name);
            if dest_path.exists() {
                let _ = fs::remove_file(&dest_path);
            }
            fs::rename(&temp_path, &dest_path)
                .map_err(|e| format!("Błąd przenoszenia pobranego pliku: {e}"))?;

            update_user_manifest_entry(
                game_dir,
                UserProjectItem {
                    id: canonical_id.clone(),
                    filename: file_name,
                    title: title.clone(),
                    icon_url,
                    enabled: true,
                    project_type: project_type.clone(),
                    is_pack_mod: None,
                    is_local: None,
                },
            );
        }

        if let Some(ref ver) = target_version {
            if let Some(deps) = ver.get("dependencies").and_then(|v| v.as_array()) {
                for dep in deps {
                    if dep.get("dependency_type").and_then(|v| v.as_str()) == Some("required") {
                        let mut dep_project_id = dep
                            .get("project_id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        if dep_project_id.is_none() {
                            if let Some(ver_id) = dep.get("version_id").and_then(|v| v.as_str()) {
                                if let Ok(v_resp) = state
                                    .http_client
                                    .get(format!("https://api.modrinth.com/v2/version/{ver_id}"))
                                    .send()
                                    .await
                                {
                                    if let Ok(v_json) = v_resp.json::<Value>().await {
                                        dep_project_id = v_json
                                            .get("project_id")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string());
                                    }
                                }
                            }
                        }

                        if let Some(dep_pid) = dep_project_id {
                            emit_status(
                                app,
                                format!(
                                    "Sprawdzanie/Pobieranie wymaganej zależności ({dep_pid}) dla {title}..."
                                ),
                            );
                            let _ = install_modrinth_project_internal(
                                app,
                                state,
                                dep_pid,
                                project_type.clone(),
                                cfg,
                                game_dir,
                                installed_set,
                            )
                            .await;
                        }
                    }
                }
            }
        }

        Ok(title)
    })
}

fn read_user_manifest(game_dir: &Path) -> Vec<UserProjectItem> {
    let manifest_path = game_dir.join("user-manifest.json");
    if !manifest_path.exists() {
        return Vec::new();
    }
    fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<UserProjectItem>>(&s).ok())
        .unwrap_or_default()
}

fn write_user_manifest(game_dir: &Path, items: &[UserProjectItem]) {
    let manifest_path = game_dir.join("user-manifest.json");
    if let Ok(serialized) = serde_json::to_string_pretty(items) {
        let _ = fs::write(manifest_path, serialized);
    }
}

fn update_user_manifest_entry(game_dir: &Path, entry: UserProjectItem) {
    let mut user_projects = read_user_manifest(game_dir);
    user_projects.retain(|p| p.id != entry.id);
    user_projects.push(entry);
    write_user_manifest(game_dir, &user_projects);
}

#[tauri::command]
pub async fn install_modrinth_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    project_type: String,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let ptype = if project_type.trim().is_empty() {
        "mod".to_string()
    } else {
        project_type
    };
    let mut installed_set = HashSet::new();

    match install_modrinth_project_internal(
        &app,
        &state,
        project_id.clone(),
        ptype,
        &cfg,
        &game_dir,
        &mut installed_set,
    )
    .await
    {
        Ok(title) => {
            emit_status(&app, format!("Zainstalowano pomyślnie: {title}!"));
            Ok(json!({ "success": true }))
        }
        Err(e) => {
            emit_status(&app, format!("Błąd instalacji: {e}"));
            Ok(json!({ "success": false, "error": e }))
        }
    }
}

#[tauri::command]
pub async fn get_user_projects(
    state: State<'_, AppState>,
    project_type: String,
) -> Result<Vec<UserProjectItem>, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let mod_cache = state.mod_cache.clone();

    let items = tokio::task::spawn_blocking(move || {
        if project_type == "pack-mod" || project_type == "pack-resourcepack" {
            let manifest_path = game_dir.join("pack-manifest.json");
            let is_mod = project_type == "pack-mod";
            let target_dir = game_dir.join(if is_mod { "mods" } else { "resourcepacks" });
            let prefix = if is_mod { "mods/" } else { "resourcepacks/" };
            let ext = if is_mod { ".jar" } else { ".zip" };

            if !manifest_path.exists() {
                return Vec::new();
            }
            let Ok(raw) = fs::read_to_string(&manifest_path) else {
                return Vec::new();
            };
            let Ok(manifest_files) = serde_json::from_str::<Vec<String>>(&raw) else {
                return Vec::new();
            };

            let candidates: Vec<(String, PathBuf, bool)> = manifest_files
                .into_iter()
                .filter(|f| {
                    let l = f.to_ascii_lowercase();
                    l.starts_with(prefix) && (l.ends_with(ext) || l.ends_with(".disabled"))
                })
                .filter_map(|file_rel| {
                    let raw_name = Path::new(&file_rel)
                        .file_name()?
                        .to_string_lossy()
                        .to_string();
                    let base_filename = strip_disabled_suffix(&raw_name).to_string();
                    let standard_path = target_dir.join(&base_filename);
                    let disabled_path = target_dir.join(format!("{base_filename}.disabled"));

                    if standard_path.exists() {
                        Some((base_filename, standard_path, true))
                    } else if disabled_path.exists() {
                        Some((base_filename, disabled_path, false))
                    } else {
                        None
                    }
                })
                .collect();

            return candidates
                .into_par_iter()
                .map(|(base_filename, actual_path, enabled)| {
                    let fallback_title = base_filename
                        .strip_suffix(ext)
                        .or_else(|| {
                            if base_filename.len() > ext.len()
                                && base_filename[base_filename.len() - ext.len()..]
                                    .eq_ignore_ascii_case(ext)
                            {
                                Some(&base_filename[..base_filename.len() - ext.len()])
                            } else {
                                None
                            }
                        })
                        .unwrap_or(&base_filename)
                        .to_string();

                    let title = if is_mod {
                        get_jar_mod_metadata(&mod_cache, &actual_path)
                            .and_then(|m| m.name)
                            .filter(|n| !n.trim().is_empty())
                            .unwrap_or(fallback_title)
                    } else {
                        fallback_title
                    };

                    UserProjectItem {
                        id: format!("pack-{base_filename}"),
                        filename: base_filename,
                        title,
                        icon_url: None,
                        enabled,
                        project_type: project_type.clone(),
                        is_pack_mod: Some(true),
                        is_local: None,
                    }
                })
                .collect();
        }

        let target_dir = get_folder_for_project_type(&game_dir, &project_type);
        let user_projects = read_user_manifest(&game_dir);

        let pack_manifest_path = game_dir.join("pack-manifest.json");
        let mut pack_manifest_files: HashSet<String> = HashSet::new();
        if pack_manifest_path.exists() {
            if let Ok(raw) = fs::read_to_string(&pack_manifest_path) {
                if let Ok(arr) = serde_json::from_str::<Vec<String>>(&raw) {
                    let prefix = match project_type.as_str() {
                        "resourcepack" => "resourcepacks/",
                        "shader" => "shaderpacks/",
                        _ => "mods/",
                    };
                    for m_file in arr {
                        if m_file.to_ascii_lowercase().starts_with(prefix) {
                            if let Some(base) = Path::new(&m_file).file_name().and_then(|s| s.to_str()) {
                                pack_manifest_files
                                    .insert(strip_disabled_suffix(base).to_ascii_lowercase());
                            }
                        }
                    }
                }
            }
        }

        let mut filtered_projects: Vec<UserProjectItem> = Vec::new();
        let mut other_projects: Vec<UserProjectItem> = Vec::new();
        let mut manifest_changed = false;

        for mut project in user_projects {
            let item_type = if project.project_type.is_empty() {
                "mod".to_string()
            } else {
                project.project_type.clone()
            };
            if item_type != project_type {
                other_projects.push(project);
                continue;
            }

            let standard_path = target_dir.join(&project.filename);
            let disabled_path = target_dir.join(format!("{}.disabled", project.filename));
            let exists_standard = standard_path.exists();
            let exists_disabled = disabled_path.exists();

            if !exists_standard && !exists_disabled {
                manifest_changed = true;
                continue;
            }
            if pack_manifest_files.contains(&project.filename.to_ascii_lowercase()) {
                continue;
            }

            project.project_type = project_type.clone();
            project.enabled = exists_standard;
            filtered_projects.push(project);
        }

        let expected_ext = if project_type == "mod" { ".jar" } else { ".zip" };
        if target_dir.exists() {
            if let Ok(entries) = fs::read_dir(&target_dir) {
                for entry in entries.flatten() {
                    let file = entry.file_name().to_string_lossy().to_string();
                    let lower = file.to_ascii_lowercase();
                    let is_standard = lower.ends_with(expected_ext);
                    let is_disabled = ends_with_disabled(&file)
                        && strip_disabled_suffix(&lower).ends_with(expected_ext);

                    if !is_standard && !is_disabled {
                        continue;
                    }

                    let base_filename = if is_standard {
                        file.clone()
                    } else {
                        strip_disabled_suffix(&file).to_string()
                    };

                    if pack_manifest_files.contains(&base_filename.to_ascii_lowercase()) {
                        continue;
                    }
                    if filtered_projects
                        .iter()
                        .any(|p| p.filename == base_filename)
                    {
                        continue;
                    }

                    let raw_title = base_filename[..base_filename.len().saturating_sub(4)].to_string();
                    filtered_projects.push(UserProjectItem {
                        id: format!("local-{base_filename}"),
                        filename: base_filename,
                        title: raw_title,
                        icon_url: None,
                        enabled: is_standard,
                        project_type: project_type.clone(),
                        is_pack_mod: None,
                        is_local: Some(true),
                    });
                    manifest_changed = true;
                }
            }
        }

        if manifest_changed {
            let mut next_manifest = other_projects;
            next_manifest.extend(
                filtered_projects
                    .iter()
                    .filter(|p| p.is_local != Some(true))
                    .cloned(),
            );
            write_user_manifest(&game_dir, &next_manifest);
        }

        filtered_projects
    })
    .await
    .unwrap_or_default();

    Ok(items)
}

fn find_matching_disk_file(target_dir: &Path, target_filename: &str) -> (Option<String>, Option<String>) {
    let clean_target = target_filename.to_ascii_lowercase();
    let stem = clean_target
        .strip_suffix(".jar")
        .or_else(|| clean_target.strip_suffix(".zip"))
        .unwrap_or(&clean_target);

    let disk_files: Vec<String> = fs::read_dir(target_dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();

    let exact_std = disk_files
        .iter()
        .find(|f| !ends_with_disabled(f) && f.to_ascii_lowercase() == clean_target)
        .cloned();
    let exact_dis = disk_files
        .iter()
        .find(|f| {
            ends_with_disabled(f) && f.to_ascii_lowercase() == format!("{clean_target}.disabled")
        })
        .cloned();
    let fuzzy_std = disk_files
        .iter()
        .find(|f| !ends_with_disabled(f) && f.to_ascii_lowercase().contains(stem))
        .cloned();
    let fuzzy_dis = disk_files
        .iter()
        .find(|f| ends_with_disabled(f) && f.to_ascii_lowercase().contains(stem))
        .cloned();

    (exact_std.or(fuzzy_std), exact_dis.or(fuzzy_dis))
}

#[tauri::command]
pub async fn toggle_project(
    state: State<'_, AppState>,
    filename: String,
    enabled: bool,
    project_type: String,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let target_dir = get_folder_for_project_type(&game_dir, &project_type);

    if !target_dir.exists() {
        return Ok(json!({ "success": false, "error": "Katalog nie istnieje." }));
    }

    let (standard_file, disabled_file) = find_matching_disk_file(&target_dir, &filename);

    if enabled {
        if let Some(dis) = disabled_file {
            let src = target_dir.join(&dis);
            let dst = target_dir.join(strip_disabled_suffix(&dis));
            if let Err(e) = fs::rename(&src, &dst) {
                return Ok(json!({ "success": false, "error": e.to_string() }));
            }
        }
    } else if let Some(std_f) = standard_file {
        let src = target_dir.join(&std_f);
        let dst = target_dir.join(format!("{std_f}.disabled"));
        if let Err(e) = fs::rename(&src, &dst) {
            return Ok(json!({ "success": false, "error": e.to_string() }));
        }
    }

    let clean_target = filename.to_ascii_lowercase();
    let stem = clean_target
        .strip_suffix(".jar")
        .or_else(|| clean_target.strip_suffix(".zip"))
        .unwrap_or(&clean_target);

    let mut manifest = read_user_manifest(&game_dir);
    if !manifest.is_empty() {
        for item in &mut manifest {
            let item_lower = item.filename.to_ascii_lowercase();
            if item_lower == clean_target || item_lower.contains(stem) {
                item.enabled = enabled;
            }
        }
        write_user_manifest(&game_dir, &manifest);
    }

    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, AppState>,
    filename: String,
    project_type: String,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let target_dir = get_folder_for_project_type(&game_dir, &project_type);

    if !target_dir.exists() {
        return Ok(json!({ "success": true }));
    }

    let clean_target = filename.to_ascii_lowercase();
    let stem = clean_target
        .strip_suffix(".jar")
        .or_else(|| clean_target.strip_suffix(".zip"))
        .unwrap_or(&clean_target);

    if let Ok(entries) = fs::read_dir(&target_dir) {
        for entry in entries.flatten() {
            let f = entry.file_name().to_string_lossy().to_string();
            let f_clean = f.to_ascii_lowercase();
            if f_clean == clean_target
                || f_clean == format!("{clean_target}.disabled")
                || f_clean.contains(stem)
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    let mut manifest = read_user_manifest(&game_dir);
    if !manifest.is_empty() {
        manifest.retain(|p| {
            let l = p.filename.to_ascii_lowercase();
            !(l == clean_target || l.contains(stem))
        });
        write_user_manifest(&game_dir, &manifest);
    }

    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn add_local_project(
    state: State<'_, AppState>,
    file_path: String,
    project_type: String,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let mod_cache = state.mod_cache.clone();

    let res = tokio::task::spawn_blocking(move || {
        let src_path = Path::new(&file_path);
        if !src_path.exists() {
            return json!({ "success": false, "error": "Plik źródłowy nie istnieje." });
        }

        let Some(filename) = src_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
        else {
            return json!({ "success": false, "error": "Nieprawidłowa nazwa pliku." });
        };

        let lower = filename.to_ascii_lowercase();
        let is_jar = lower.ends_with(".jar");
        let is_zip = lower.ends_with(".zip");

        if project_type == "mod" && !is_jar {
            return json!({ "success": false, "error": "Modyfikacja musi mieć rozszerzenie .jar!" });
        }
        if project_type != "mod" && !is_zip {
            return json!({ "success": false, "error": "Shadery i Paczki zasobów muszą mieć rozszerzenie .zip!" });
        }

        let target_dir = get_folder_for_project_type(&game_dir, &project_type);
        if let Err(e) = fs::create_dir_all(&target_dir) {
            return json!({ "success": false, "error": e.to_string() });
        }

        let dest_path = target_dir.join(&filename);
        let temp_path = game_dir.join(format!("temp_{filename}"));
        if let Err(e) = fs::copy(src_path, &temp_path) {
            return json!({ "success": false, "error": format!("Błąd kopiowania pliku: {e}") });
        }

        let mut internal_id: Option<String> = None;
        let mut display_name = filename[..filename.len().saturating_sub(4)].to_string();

        if project_type == "mod" {
            if let Some(meta) = get_jar_mod_metadata(&mod_cache, &temp_path) {
                internal_id = meta.id.clone();
                if let Some(name) = meta.name {
                    if !name.trim().is_empty() {
                        display_name = name;
                    }
                }
            }
            if let Some(ref iid) = internal_id {
                let main_pack = get_main_pack_mod_ids_set(&mod_cache, &game_dir);
                if main_pack.contains(&iid.to_ascii_lowercase()) {
                    let _ = fs::remove_file(&temp_path);
                    return json!({
                        "success": false,
                        "error": format!("Mod \"{display_name}\" jest już częścią paczki głównej!")
                    });
                }
            }
        }

        let disabled_dest = target_dir.join(format!("{filename}.disabled"));
        if dest_path.exists() || disabled_dest.exists() {
            let _ = fs::remove_file(&temp_path);
            return json!({
                "success": false,
                "error": format!("Plik o nazwie \"{filename}\" jest już zainstalowany.")
            });
        }

        if let Err(e) = fs::rename(&temp_path, &dest_path) {
            let _ = fs::remove_file(&temp_path);
            return json!({ "success": false, "error": e.to_string() });
        }

        let id = format!(
            "local-{}",
            internal_id
                .clone()
                .unwrap_or_else(|| display_name.split_whitespace().collect::<Vec<_>>().join("-"))
        );
        let mut manifest = read_user_manifest(&game_dir);
        manifest.retain(|p| {
            !(p.id == id && (p.project_type.as_str() == project_type || (p.project_type.is_empty() && project_type == "mod")))
        });
        manifest.push(UserProjectItem {
            id,
            filename,
            title: display_name.clone(),
            icon_url: None,
            enabled: true,
            project_type,
            is_pack_mod: None,
            is_local: None,
        });
        write_user_manifest(&game_dir, &manifest);

        json!({ "success": true, "title": display_name })
    })
    .await
    .unwrap_or_else(|e| json!({ "success": false, "error": e.to_string() }));

    Ok(res)
}

#[derive(Debug, Clone)]
struct CustomModHashMeta {
    hash: String,
    filename: String,
    title: String,
    icon_url: Option<String>,
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

#[tauri::command]
pub async fn check_mod_updates(
    state: State<'_, AppState>,
    _project_type: Option<String>,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let mods_dir = game_dir.join("mods");

    if !mods_dir.exists() {
        return Ok(json!({ "success": true, "updates": [] }));
    }

    let custom_metas = tokio::task::spawn_blocking(move || {
        let pack_manifest_path = game_dir.join("pack-manifest.json");
        let mut pack_files: HashSet<String> = HashSet::new();
        if pack_manifest_path.exists() {
            if let Ok(raw) = fs::read_to_string(&pack_manifest_path) {
                if let Ok(arr) = serde_json::from_str::<Vec<String>>(&raw) {
                    for item in arr {
                        if item.to_ascii_lowercase().starts_with("mods/") {
                            if let Some(base) = Path::new(&item).file_name().and_then(|s| s.to_str()) {
                                pack_files.insert(strip_disabled_suffix(base).to_ascii_lowercase());
                            }
                        }
                    }
                }
            }
        }

        let user_projects = read_user_manifest(&game_dir);
        let jar_paths: Vec<(String, String, PathBuf)> = fs::read_dir(&mods_dir)
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| {
                        let f = e.file_name().to_string_lossy().to_string();
                        let l = f.to_ascii_lowercase();
                        if l.ends_with(".jar") || l.ends_with(".jar.disabled") {
                            let clean_base = strip_disabled_suffix(&f).to_ascii_lowercase();
                            if !pack_files.contains(&clean_base) {
                                return Some((f, clean_base, e.path()));
                            }
                        }
                        None
                    })
                    .collect()
            })
            .unwrap_or_default();

        jar_paths
            .into_par_iter()
            .filter_map(|(filename, clean_base, path)| {
                let hash = sha1_file_hex(&path)?;
                let user_proj = user_projects
                    .iter()
                    .find(|p| p.filename.to_ascii_lowercase() == clean_base);
                let fallback_title = strip_disabled_suffix(&filename)
                    .strip_suffix(".jar")
                    .or_else(|| strip_disabled_suffix(&filename).strip_suffix(".JAR"))
                    .unwrap_or(strip_disabled_suffix(&filename))
                    .to_string();

                Some(CustomModHashMeta {
                    hash,
                    filename,
                    title: user_proj
                        .map(|p| p.title.clone())
                        .unwrap_or(fallback_title),
                    icon_url: user_proj.and_then(|p| p.icon_url.clone()),
                })
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();

    if custom_metas.is_empty() {
        return Ok(json!({ "success": true, "updates": [] }));
    }

    let hashes: Vec<String> = custom_metas.iter().map(|m| m.hash.clone()).collect();
    let hash_map: HashMap<String, CustomModHashMeta> = custom_metas
        .into_iter()
        .map(|m| (m.hash.clone(), m))
        .collect();

    let target_mc = if cfg.minecraft_version.is_empty() {
        "1.20.1"
    } else {
        cfg.minecraft_version.as_str()
    };
    let target_loader = if cfg.loader.is_empty() {
        "fabric"
    } else {
        cfg.loader.as_str()
    };

    let body = json!({
        "hashes": hashes,
        "algorithm": "sha1",
        "game_versions": [target_mc],
        "loaders": [target_loader]
    });

    let resp = match state
        .http_client
        .post("https://api.modrinth.com/v2/version_files/update")
        .json(&body)
        .timeout(Duration::from_secs(15))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Ok(json!({ "success": false, "error": e.to_string(), "updates": [] })),
    };

    if !resp.status().is_success() {
        return Ok(json!({
            "success": false,
            "error": format!("HTTP {} z API Modrinth", resp.status().as_u16()),
            "updates": []
        }));
    }

    let Ok(map) = resp.json::<HashMap<String, Value>>().await else {
        return Ok(json!({ "success": false, "error": "Błąd parsowania JSON z Modrinth.", "updates": [] }));
    };

    let mut updates: Vec<ModUpdateInfo> = Vec::new();
    let gv_param = format!("[\"{target_mc}\"]");
    let loaders_param = format!("[\"{target_loader}\"]");

    for (old_hash, new_ver_data) in map {
        let Some(mod_meta) = hash_map.get(&old_hash) else {
            continue;
        };

        let mut chosen_version = new_ver_data.clone();
        if chosen_version.get("version_type").and_then(|v| v.as_str()) != Some("release") {
            let Some(pid) = chosen_version.get("project_id").and_then(|v| v.as_str()) else {
                continue;
            };
            let v_res = state
                .http_client
                .get(format!("https://api.modrinth.com/v2/project/{pid}/version"))
                .query(&[
                    ("game_versions", gv_param.as_str()),
                    ("loaders", loaders_param.as_str()),
                ])
                .timeout(Duration::from_secs(8))
                .send()
                .await;

            let Ok(v_resp) = v_res else { continue };
            let Ok(v_list) = v_resp.json::<Vec<Value>>().await else {
                continue;
            };
            let Some(latest_stable) = v_list
                .into_iter()
                .find(|v| v.get("version_type").and_then(|x| x.as_str()) == Some("release"))
            else {
                continue;
            };
            chosen_version = latest_stable;
        }

        let Some(files) = chosen_version.get("files").and_then(|v| v.as_array()) else {
            continue;
        };
        let Some(primary_file) = files
            .iter()
            .find(|f| f.get("primary").and_then(|v| v.as_bool()) == Some(true))
            .or_else(|| files.first())
        else {
            continue;
        };

        let remote_sha1 = primary_file
            .get("hashes")
            .and_then(|h| h.get("sha1"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if remote_sha1.is_empty() || remote_sha1 == old_hash {
            continue;
        }

        let Some(new_filename) = primary_file
            .get("filename")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
        else {
            continue;
        };
        let Some(download_url) = primary_file
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
        else {
            continue;
        };

        let project_id = chosen_version
            .get("project_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let new_version = chosen_version
            .get("version_number")
            .or_else(|| chosen_version.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let version_type = chosen_version
            .get("version_type")
            .and_then(|v| v.as_str())
            .unwrap_or("release")
            .to_string();
        let changelog = chosen_version
            .get("changelog")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let date_published = chosen_version
            .get("date_published")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        updates.push(ModUpdateInfo {
            old_filename: mod_meta.filename.clone(),
            title: mod_meta.title.clone(),
            icon_url: mod_meta.icon_url.clone(),
            project_id,
            new_filename,
            new_version,
            version_type,
            download_url,
            changelog,
            date_published,
        });
    }

    Ok(json!({ "success": true, "updates": updates }))
}

#[tauri::command]
pub async fn get_mod_available_versions(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let target_mc = if cfg.minecraft_version.is_empty() {
        "1.20.1"
    } else {
        cfg.minecraft_version.as_str()
    };
    let target_loader = if cfg.loader.is_empty() {
        "fabric"
    } else {
        cfg.loader.as_str()
    };

    let gv_param = format!("[\"{target_mc}\"]");
    let loaders_param = format!("[\"{target_loader}\"]");

    let resp = match state
        .http_client
        .get(format!(
            "https://api.modrinth.com/v2/project/{project_id}/version"
        ))
        .query(&[
            ("game_versions", gv_param.as_str()),
            ("loaders", loaders_param.as_str()),
        ])
        .timeout(Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Ok(json!({ "success": false, "error": e.to_string() })),
    };

    if !resp.status().is_success() {
        return Ok(json!({ "success": false, "error": "Nieprawidłowa odpowiedź z API Modrinth" }));
    }

    let Ok(list) = resp.json::<Vec<Value>>().await else {
        return Ok(json!({ "success": false, "error": "Nieprawidłowa odpowiedź z API Modrinth" }));
    };

    let versions: Vec<ModVersionOption> = list
        .into_iter()
        .filter(|v| v.get("version_type").and_then(|x| x.as_str()) == Some("release"))
        .filter_map(|v| {
            let files = v.get("files").and_then(|f| f.as_array())?;
            let primary = files
                .iter()
                .find(|f| f.get("primary").and_then(|b| b.as_bool()) == Some(true))
                .or_else(|| files.first())?;
            let download_url = primary.get("url").and_then(|u| u.as_str())?.to_string();

            Some(ModVersionOption {
                id: v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                name: v
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                version_number: v
                    .get("version_number")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                version_type: "release".to_string(),
                date_published: v
                    .get("date_published")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string()),
                changelog: v
                    .get("changelog")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                filename: primary
                    .get("filename")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string()),
                download_url: Some(download_url),
                size: primary.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
            })
        })
        .collect();

    Ok(json!({ "success": true, "versions": versions }))
}

async fn apply_single_mod_update(
    app: &AppHandle,
    state: &AppState,
    game_dir: &Path,
    mods_dir: &Path,
    upd: &UpdateModInput,
) -> Result<String, String> {
    let is_old_disabled = ends_with_disabled(&upd.old_filename);
    let actual_new_filename = if is_old_disabled && !ends_with_disabled(&upd.new_filename) {
        format!("{}.disabled", upd.new_filename)
    } else {
        upd.new_filename.clone()
    };

    let dest_path = mods_dir.join(&actual_new_filename);
    emit_status(app, format!("Pobieranie aktualizacji: {}...", upd.new_filename));

    download_file_stream::<fn(_)>(
        &state.download_client,
        &upd.download_url,
        &dest_path,
        None,
    )
    .await?;

    let clean_old = strip_disabled_suffix(&upd.old_filename);
    let old_std = mods_dir.join(clean_old);
    let old_dis = mods_dir.join(format!("{clean_old}.disabled"));

    if old_std != dest_path && old_std.exists() {
        let _ = fs::remove_file(&old_std);
    }
    if old_dis != dest_path && old_dis.exists() {
        let _ = fs::remove_file(&old_dis);
    }

    let clean_new = strip_disabled_suffix(&actual_new_filename);
    let mut manifest = read_user_manifest(game_dir);
    let mut changed = false;
    for item in &mut manifest {
        if item.filename == clean_old || item.filename == upd.old_filename {
            item.filename = clean_new.to_string();
            changed = true;
        }
    }
    if changed {
        write_user_manifest(game_dir, &manifest);
    }

    Ok(actual_new_filename)
}

#[tauri::command]
pub async fn update_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    update_data: UpdateModInput,
) -> Result<Value, String> {
    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let mods_dir = game_dir.join("mods");

    match apply_single_mod_update(&app, &state, &game_dir, &mods_dir, &update_data).await {
        Ok(new_filename) => {
            emit_status(&app, format!("Zaktualizowano: {}!", update_data.new_filename));
            Ok(json!({ "success": true, "newFilename": new_filename }))
        }
        Err(e) => Ok(json!({ "success": false, "error": e })),
    }
}

#[tauri::command]
pub async fn update_all_mods(
    app: AppHandle,
    state: State<'_, AppState>,
    updates_list: Vec<UpdateModInput>,
) -> Result<Value, String> {
    if updates_list.is_empty() {
        return Ok(json!({ "success": true, "updatedCount": 0 }));
    }

    let cfg = {
        let _g = state.config_lock.lock().await;
        state.read_config()
    };
    let game_dir = PathBuf::from(&cfg.game_dir);
    let mods_dir = game_dir.join("mods");

    let total = updates_list.len();
    let mut updated_count = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for upd in &updates_list {
        match apply_single_mod_update(&app, &state, &game_dir, &mods_dir, upd).await {
            Ok(_) => updated_count += 1,
            Err(e) => errors.push(format!("{}: {e}", upd.old_filename)),
        }
    }

    emit_status(&app, format!("Zaktualizowano {updated_count} z {total} modów."));
    Ok(json!({
        "success": true,
        "updatedCount": updated_count,
        "errors": errors
    }))
}

pub fn clean_duplicate_mods(state: &AppState, mods_dir: &Path) {
    if !mods_dir.exists() {
        return;
    }

    let jar_paths: Vec<PathBuf> = fs::read_dir(mods_dir)
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
            let meta = get_jar_mod_metadata(&state.mod_cache, path)?;
            let mod_id = meta.id?;
            let (mtime, _) = file_mtime_and_size(path)?;
            let filename = path.file_name()?.to_string_lossy().to_string();
            Some((mod_id, filename, path.clone(), mtime))
        })
        .collect();

    let mut by_id: HashMap<String, Vec<(String, PathBuf, u128)>> = HashMap::new();
    for (mod_id, filename, path, mtime) in entries {
        by_id.entry(mod_id).or_default().push((filename, path, mtime));
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
        state.log_to_file(&format!(
            "[SYSTEM] Wykryto i wyłączono duplikaty modów: {}",
            disabled_list.join(", ")
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn test_clean_id_strips_symbols() {
        assert_eq!(clean_id("Sodium-Fabric_1.20.1"), "sodiumfabric1201");
        assert_eq!(clean_id("Complementary Reimagined"), "complementaryreimagined");
    }

    #[test]
    fn test_read_fabric_mod_json_from_zip() {
        let tmp = std::env::temp_dir().join("ciapongi_test_mod.jar");
        {
            let file = File::create(&tmp).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = SimpleFileOptions::default();
            zip.start_file("fabric.mod.json", options).unwrap();
            zip.write_all(br#"{"schemaVersion":1,"id":"test_mod","name":"Test Mod Name"}"#)
                .unwrap();
            zip.start_file("dummy/Class.class", options).unwrap();
            zip.write_all(b"CAFEBABE").unwrap();
            zip.finish().unwrap();
        }

        let meta = read_fabric_mod_json(&tmp).expect("Powinien odczytać fabric.mod.json");
        assert_eq!(meta.id.as_deref(), Some("test_mod"));
        assert_eq!(meta.name.as_deref(), Some("Test Mod Name"));
        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn test_read_fabric_mod_json_direct_stored_bom_and_large_cd() {
        let tmp = std::env::temp_dir().join("ciapongi_test_large_cd.jar");
        {
            let file = File::create(&tmp).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let stored = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            // Ponad 1500 wpisów wymusza Central Directory większe niż 64KB tail buffer
            for idx in 0..1600 {
                zip.start_file(format!("com/example/very/long/package/path/Class_{idx:04}.class"), stored)
                    .unwrap();
                zip.write_all(b"CA").unwrap();
            }
            zip.start_file("fabric.mod.json", stored).unwrap();
            zip.write_all("\u{feff}{\"id\":\"stored_mod\",\"name\":\"Stored Mod\"}".as_bytes())
                .unwrap();
            zip.finish().unwrap();
        }

        let meta = read_fabric_mod_json(&tmp).expect("Powinien odczytać stored fabric.mod.json z dużego CD");
        assert_eq!(meta.id.as_deref(), Some("stored_mod"));
        assert_eq!(meta.name.as_deref(), Some("Stored Mod"));
        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn test_read_fabric_mod_json_missing_entry_returns_none() {
        let tmp = std::env::temp_dir().join("ciapongi_test_missing.jar");
        {
            let file = File::create(&tmp).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = SimpleFileOptions::default();
            zip.start_file("META-INF/MANIFEST.MF", options).unwrap();
            zip.write_all(b"Manifest-Version: 1.0\n").unwrap();
            zip.finish().unwrap();
        }

        assert!(read_fabric_mod_json(&tmp).is_none());
        let _ = fs::remove_file(&tmp);
    }
}

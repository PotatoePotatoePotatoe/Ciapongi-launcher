use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use ciapongi_rp_launcher_lib::mc_launcher::{
    build_gc_args, eval_rules, get_latest_fabric_loader, parse_maven_coord,
};
use ciapongi_rp_launcher_lib::modrinth::{
    execute_modrinth_search_uncached, get_main_pack_mod_ids_set, read_fabric_mod_json,
    ModCacheState,
};
use ciapongi_rp_launcher_lib::state::{compare_semver, is_newer_version, USER_AGENT};

const REAL_GAME_DIR: &str = "/home/mati/Dokumenty/CiapongiRP/minecraft-instance";

#[test]
#[ignore = "Wymaga lokalnej instancji Minecraft oraz połączenia sieciowego"]
fn benchmark_real_instance_and_modrinth_parity() {
    let rt = tokio::runtime::Runtime::new().expect("Tokio runtime");
    let game_dir = PathBuf::from(REAL_GAME_DIR);
    assert!(
        game_dir.exists(),
        "Oczekiwano lokalnej instancji w {}",
        game_dir.display()
    );

    // 1. Zimny skan JARów paczki (rayon + ZIP Central Directory -> fabric.mod.json)
    let mod_cache = Arc::new(ModCacheState::new());
    let t0 = Instant::now();
    let pack_ids = get_main_pack_mod_ids_set(&mod_cache, &game_dir);
    let cold_scan_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let t1 = Instant::now();
    let pack_ids_warm = get_main_pack_mod_ids_set(&mod_cache, &game_dir);
    let warm_scan_ms = t1.elapsed().as_secs_f64() * 1000.0;

    println!(
        "[BENCH] Pack JAR scan (cold, {} unikalnych ID): {:.2} ms",
        pack_ids.len(),
        cold_scan_ms
    );
    println!(
        "[BENCH] Pack JAR scan (warm cache, {} ID): {:.4} ms",
        pack_ids_warm.len(),
        warm_scan_ms
    );
    assert!(pack_ids.len() > 20, "Zbyt mało wykrytych modów w paczce");

    // 2. Weryfikacja równoległego odczytu wszystkich JAR-ów w mods/ (100% parytet z ZipArchive)
    let mods_dir = game_dir.join("mods");
    let jar_paths: Vec<PathBuf> = fs::read_dir(&mods_dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().ends_with(".jar"))
        .map(|e| e.path())
        .collect();
    println!("[INFO] Pliki .jar w mods/: {}", jar_paths.len());

    for jp in &jar_paths {
        let direct = read_fabric_mod_json(jp);
        let fallback = {
            let f = fs::File::open(jp).unwrap();
            let mut arch = zip::ZipArchive::new(std::io::BufReader::new(f)).unwrap();
            let parsed_opt = match arch.by_name("fabric.mod.json") {
                Ok(mut entry) => {
                    let mut raw = String::new();
                    std::io::Read::read_to_string(&mut entry, &mut raw).ok();
                    serde_json::from_str::<serde_json::Value>(raw.trim_start_matches('\u{feff}'))
                        .ok()
                        .map(|parsed| ciapongi_rp_launcher_lib::modrinth::ModJarMeta {
                            id: parsed.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            name: parsed.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        })
                }
                Err(_) => None,
            };
            parsed_opt
        };
        assert_eq!(
            direct,
            fallback,
            "Rozbieżność direct EOCD vs ZipArchive dla {}",
            jp.display()
        );
    }

    // 3. Test realnego zapytania Modrinth API (cold + warm jar cache)
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();

    rt.block_on(async {
        // Test z pustym ModCacheState (zimny HTTP + zimny skan JAR w tokio::join!)
        let t_api0 = Instant::now();
        let hits = execute_modrinth_search_uncached(
            &client,
            Arc::new(ModCacheState::new()),
            game_dir.clone(),
            "sodium",
            "1.20.1",
            "mod",
        )
        .await
        .expect("execute_modrinth_search_uncached");
        let api_ms = t_api0.elapsed().as_secs_f64() * 1000.0;

        println!(
            "[BENCH] Modrinth live search + cold pack match ('sodium', {} wyników): {:.2} ms",
            hits.len(),
            api_ms
        );
        assert!(!hits.is_empty());

        let has_sodium_in_pack = hits.iter().any(|h| h.in_main_pack);
        println!("[INFO] Wykryto mod z paczki ('inMainPack') w wynikach: {has_sodium_in_pack}");
        assert!(has_sodium_in_pack, "Sodium powinno być oznaczone jako inMainPack");

        // Test z rozgrzanym ModCacheState (kolejne wyszukiwanie po 1. skanie)
        let t_api1 = Instant::now();
        let hits_warm = execute_modrinth_search_uncached(
            &client,
            mod_cache.clone(),
            game_dir.clone(),
            "iris",
            "1.20.1",
            "mod",
        )
        .await
        .expect("execute_modrinth_search_uncached warm");
        let api_warm_ms = t_api1.elapsed().as_secs_f64() * 1000.0;
        println!(
            "[BENCH] Modrinth live search + warm jar cache ('iris', {} wyników): {:.2} ms",
            hits_warm.len(),
            api_warm_ms
        );
        assert!(!hits_warm.is_empty());

        // 4. Test realnego API Fabric Loader + ciapongi.szablix.pl
        let fabric_latest = get_latest_fabric_loader(&client, "1.20.1")
            .await
            .expect("Fabric Meta API");
        println!("[INFO] Najnowszy stabilny Fabric Loader 1.20.1: {fabric_latest}");

        let pack_resp = client
            .get("https://ciapongi.szablix.pl/paczki")
            .send()
            .await
            .expect("ciapongi.szablix.pl/paczki");
        assert!(pack_resp.status().is_success());
        let packs: Vec<serde_json::Value> = pack_resp.json().await.unwrap();
        println!(
            "[INFO] ciapongi.szablix.pl/paczki: {} wydań (najnowsze: {})",
            packs.len(),
            packs.first().and_then(|p| p["version"].as_str()).unwrap_or("?")
        );

        // Zgodnie z updater.rs: najpierw ciapongi.szablix.pl, a przy 404 fallback na GitHub Releases API
        let mut remote_tag = String::new();
        let mut source = "";
        for ep in [
            "https://ciapongi.szablix.pl/launcher/latest.json",
            "https://ciapongi.szablix.pl/launcher",
        ] {
            if let Ok(r) = client.get(ep).send().await {
                if r.status().is_success() {
                    if let Ok(v) = r.json::<serde_json::Value>().await {
                        if let Some(t) = v["tag_name"].as_str().or_else(|| v["version"].as_str()) {
                            remote_tag = t.to_string();
                            source = ep;
                            break;
                        }
                    }
                }
            }
        }
        if remote_tag.is_empty() {
            let gh_resp = client
                .get("https://api.github.com/repos/PotatoePotatoePotatoe/Ciapongi-launcher/releases/latest")
                .send()
                .await
                .expect("GitHub Releases fallback");
            assert!(gh_resp.status().is_success());
            let gh_json: serde_json::Value = gh_resp.json().await.unwrap();
            remote_tag = gh_json["tag_name"].as_str().unwrap_or("").to_string();
            source = "GitHub Releases fallback";
        }
        println!("[INFO] Zdalna wersja launchera ({source}): {remote_tag}");
        assert!(!remote_tag.is_empty(), "Nie udało się ustalić zdalnej wersji");
        assert!(
            !is_newer_version(&remote_tag, "2.0.0"),
            "Wersja 2.0.0 nie powinna cofać się do starszej zdalnej wersji {remote_tag}"
        );
    });

    // 5. Weryfikacja spójności istniejącego profilu Fabric + Mojang + Assetów (zero pobierania!)
    let versions_dir = game_dir.join("versions");
    let installed_fabric_dir = fs::read_dir(&versions_dir)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.file_name().unwrap().to_string_lossy().contains("fabric-loader"))
        .expect("Folder wersji Fabric");
    let ver_id = installed_fabric_dir
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();

    let fabric_json: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(installed_fabric_dir.join(format!("{ver_id}.json"))).unwrap(),
    )
    .unwrap();
    let vanilla_json: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(installed_fabric_dir.join("1.20.1.json")).unwrap(),
    )
    .unwrap();

    let libs_dir = game_dir.join("libraries");
    let empty = HashSet::new();
    let mut fabric_overrides = HashSet::new();
    let mut missing_libs = Vec::new();
    let mut resolved_libs = 0usize;

    for lib in fabric_json["libraries"].as_array().unwrap() {
        if !eval_rules(lib.get("rules"), &empty) {
            continue;
        }
        let coord = parse_maven_coord(lib["name"].as_str().unwrap()).unwrap();
        fabric_overrides.insert((coord.group, coord.artifact, coord.classifier));
        let dest = libs_dir.join(&coord.rel_path);
        resolved_libs += 1;
        if !dest.exists() {
            missing_libs.push(coord.rel_path);
        }
    }
    for lib in vanilla_json["libraries"].as_array().unwrap() {
        if !eval_rules(lib.get("rules"), &empty) {
            continue;
        }
        let coord = parse_maven_coord(lib["name"].as_str().unwrap()).unwrap();
        if fabric_overrides.contains(&(coord.group, coord.artifact, coord.classifier)) {
            continue;
        }
        if let Some(p) = lib["downloads"]["artifact"]["path"].as_str() {
            let dest = libs_dir.join(p);
            resolved_libs += 1;
            if !dest.exists() {
                missing_libs.push(p.to_string());
            }
        }
    }

    println!(
        "[INFO] Biblioteki zweryfikowane na dysku: {resolved_libs}, brakujących: {}",
        missing_libs.len()
    );
    assert!(
        missing_libs.is_empty(),
        "Wykryto brakujące biblioteki względem MCLC: {missing_libs:?}"
    );

    let client_jar = installed_fabric_dir.join(format!("{ver_id}.jar"));
    assert!(client_jar.exists(), "Brak client JAR: {}", client_jar.display());

    let asset_index_path = game_dir
        .join("assets")
        .join("indexes")
        .join(format!("{ver_id}.json"));
    assert!(
        asset_index_path.exists(),
        "Brak indeksu assetów: {}",
        asset_index_path.display()
    );

    let (_, gc) = build_gc_args("auto", 8192, 32768, 21, "");
    assert!(gc.contains(&"-XX:+UseZGC".to_string()));
    assert_eq!(compare_semver("2.0.0", "1.1.9"), std::cmp::Ordering::Greater);

    // Odczyt przykładowego modu z paczki (test czystej funkcji read_fabric_mod_json)
    if let Some(first_jar) = fs::read_dir(&mods_dir)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().and_then(|s| s.to_str()) == Some("jar"))
    {
        let _meta = read_fabric_mod_json(Path::new(&first_jar));
    }
}


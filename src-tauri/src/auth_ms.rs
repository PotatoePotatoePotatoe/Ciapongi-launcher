use std::sync::{Arc, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;

use crate::state::{emit_status, AccountEntry, AppState, LauncherConfig};

const MS_CLIENT_ID: &str = "00000000402b5328";
const MS_REDIRECT_URI: &str = "https://login.live.com/oauth20_desktop.srf";

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_jwt_xuid(token: &str) -> String {
    let Some(payload_b64) = token.split('.').nth(1) else {
        return String::new();
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload_b64) else {
        return String::new();
    };
    let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
        return String::new();
    };
    val.get("xuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn random_client_uuid() -> String {
    let ns = now_epoch_ms() as u128 ^ (std::process::id() as u128);
    format!(
        "{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}",
        (ns & 0xffff_ffff) as u32,
        ((ns >> 32) & 0xffff) as u16,
        ((ns >> 48) & 0x0fff) as u16,
        ((ns >> 60) & 0x0fff) as u16,
        (ns ^ 0x5f37_59df_cafe_babe) & 0xffff_ffff_ffff
    )
}

fn map_xsts_error(xerr: u64) -> &'static str {
    match xerr {
        2148916233 => "To konto Microsoft nie posiada powiązanego profilu Xbox Live.",
        2148916235 => "Konto pochodzi z regionu, w którym usługa Xbox Live jest zablokowana.",
        2148916236 | 2148916237 => {
            "Konto dziecięce wymaga weryfikacji lub zgody opiekuna na xbox.com."
        }
        2148916238 => {
            "Konto dziecięce musi zostać dodane do rodziny Microsoft przed logowaniem."
        }
        _ => "Błąd autoryzacji Xbox XSTS.",
    }
}

async fn exchange_ms_token_for_mc(
    client: &reqwest::Client,
    form_params: &[(&str, &str)],
    app_opt: Option<&AppHandle>,
) -> Result<Value, String> {
    let ms_resp = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(form_params)
        .send()
        .await
        .map_err(|e| format!("Błąd połączenia z login.live.com: {e}"))?;

    if !ms_resp.status().is_success() {
        return Err(format!(
            "Błąd autoryzacji Microsoft (HTTP {}).",
            ms_resp.status().as_u16()
        ));
    }
    let ms_json = ms_resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Błąd odpowiedzi JSON z Microsoft: {e}"))?;

    let ms_access = ms_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak access_token w odpowiedzi Microsoft.".to_string())?;
    let ms_refresh = ms_json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(app) = app_opt {
        emit_status(app, "Autoryzacja Xbox Live...");
    }

    let xbl_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_access}")
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Błąd połączenia z Xbox Live: {e}"))?;

    if !xbl_resp.status().is_success() {
        return Err(format!(
            "Błąd logowania Xbox Live (HTTP {}).",
            xbl_resp.status().as_u16()
        ));
    }
    let xbl_json = xbl_resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Błąd JSON z Xbox Live: {e}"))?;

    let xbl_token = xbl_json
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak tokena Xbox Live.".to_string())?;

    let xsts_resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Błąd połączenia z XSTS: {e}"))?;

    let xsts_json = xsts_resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Błąd JSON z XSTS: {e}"))?;

    if let Some(xerr) = xsts_json.get("XErr").and_then(|v| v.as_u64()) {
        return Err(map_xsts_error(xerr).to_string());
    }

    let xsts_token = xsts_json
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak tokena XSTS.".to_string())?;
    let uhs = xsts_json
        .get("DisplayClaims")
        .and_then(|d| d.get("xui"))
        .and_then(|x| x.as_array())
        .and_then(|a| a.first())
        .and_then(|item| item.get("uhs"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak UHS w odpowiedzi XSTS.".to_string())?;

    if let Some(app) = app_opt {
        emit_status(app, "Pobieranie profilu Minecraft...");
    }

    let identity_token = format!("XBL3.0 x={uhs};{xsts_token}");
    let mc_login_resp = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({ "identityToken": identity_token }))
        .send()
        .await
        .map_err(|e| format!("Błąd logowania Minecraft Services: {e}"))?;

    if !mc_login_resp.status().is_success() {
        return Err(format!(
            "Błąd autoryzacji Mojang (HTTP {}).",
            mc_login_resp.status().as_u16()
        ));
    }
    let mc_auth = mc_login_resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Błąd odpowiedzi Minecraft auth: {e}"))?;

    let mc_token = mc_auth
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brak tokena Minecraft.".to_string())?
        .to_string();
    let mc_username_id = mc_auth
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let prof_resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {mc_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Błąd pobierania profilu Minecraft: {e}"))?;

    let prof_status = prof_resp.status();
    let prof_json = prof_resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Błąd JSON profilu Minecraft: {e}"))?;

    let (uuid, name, is_demo) = if prof_json.get("error").is_some() || !prof_status.is_success() {
        // Sprawdź uprawnienia Xbox Game Pass (tak jak w msmc)
        let ent_resp = client
            .get("https://api.minecraftservices.com/entitlements/mcstore")
            .header("Authorization", format!("Bearer {mc_token}"))
            .send()
            .await
            .ok();
        let has_gamepass = if let Some(r) = ent_resp {
            if let Ok(ent_json) = r.json::<Value>().await {
                ent_json
                    .get("items")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter().any(|item| {
                            matches!(
                                item.get("name").and_then(|n| n.as_str()),
                                Some("game_minecraft") | Some("product_minecraft")
                            )
                        })
                    })
                    .unwrap_or(false)
            } else {
                false
            }
        } else {
            false
        };

        if !has_gamepass {
            return Err("To konto Microsoft nie posiada zakupionej gry Minecraft Java Edition ani aktywnego Game Pass.".to_string());
        }

        // Spróbuj pobrać gamertag z social Xbox Live
        let mut gamertag = "Player".to_string();
        if let Ok(social_xsts) = client
            .post("https://xsts.auth.xboxlive.com/xsts/authorize")
            .header("Content-Type", "application/json")
            .json(&json!({
                "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
                "RelyingParty": "http://xboxlive.com",
                "TokenType": "JWT"
            }))
            .send()
            .await
        {
            if let Ok(sj) = social_xsts.json::<Value>().await {
                if let (Some(st), Some(suhs)) = (
                    sj.get("Token").and_then(|v| v.as_str()),
                    sj.get("DisplayClaims")
                        .and_then(|d| d.get("xui"))
                        .and_then(|x| x.as_array())
                        .and_then(|a| a.first())
                        .and_then(|item| item.get("uhs"))
                        .and_then(|v| v.as_str()),
                ) {
                    if let Ok(sp) = client
                        .get("https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag")
                        .header("Authorization", format!("XBL3.0 x={suhs};{st}"))
                        .header("x-xbl-contract-version", "2")
                        .send()
                        .await
                    {
                        if let Ok(spj) = sp.json::<Value>().await {
                            if let Some(gt) = spj
                                .get("profileUsers")
                                .and_then(|v| v.as_array())
                                .and_then(|a| a.first())
                                .and_then(|u| u.get("settings"))
                                .and_then(|v| v.as_array())
                                .and_then(|a| {
                                    a.iter().find(|s| {
                                        s.get("id").and_then(|i| i.as_str()) == Some("Gamertag")
                                    })
                                })
                                .and_then(|s| s.get("value"))
                                .and_then(|v| v.as_str())
                            {
                                gamertag = gt.to_string();
                            }
                        }
                    }
                }
            }
        }

        (mc_username_id, gamertag, false)
    } else {
        let uid = prof_json
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Brak UUID w profilu Minecraft.".to_string())?
            .to_string();
        let pname = prof_json
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Brak nazwy gracza w profilu Minecraft.".to_string())?
            .to_string();
        (uid, pname, false)
    };

    let xuid = parse_jwt_xuid(&mc_token);
    let exp = now_epoch_ms() + 1000 * 60 * 60 * 23;

    let profile = json!({
        "access_token": mc_token,
        "client_token": random_client_uuid(),
        "uuid": uuid,
        "name": name,
        "meta": {
            "xuid": xuid,
            "type": "msa",
            "demo": is_demo,
            "exp": exp,
            "refresh": ms_refresh
        },
        "user_properties": {}
    });

    Ok(json!({
        "uuid": uuid,
        "name": name,
        "access_token": mc_token,
        "profile": profile
    }))
}

pub async fn refresh_minecraft_token_if_needed(
    state: &AppState,
    cfg: &mut LauncherConfig,
) -> Result<(), String> {
    if cfg.login_type != "microsoft" {
        return Ok(());
    }
    let Some(ref auth) = cfg.microsoft_auth else {
        return Ok(());
    };
    let profile = auth.get("profile").unwrap_or(auth);
    let exp = profile
        .get("meta")
        .and_then(|m| m.get("exp"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let refresh_token = profile
        .get("meta")
        .and_then(|m| m.get("refresh"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Jeśli token ważny jeszcze > 5 minut, nie odświeżamy
    if exp > now_epoch_ms() + 5 * 60 * 1000 {
        return Ok(());
    }
    let Some(refresh) = refresh_token else {
        return Ok(());
    };

    state.log_to_file("[AUTH] Odświeżanie wygasłego tokena Microsoft przed uruchomieniem gry...");
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ];

    let new_auth = exchange_ms_token_for_mc(&state.http_client, &params, None).await?;
    cfg.microsoft_auth = Some(new_auth.clone());

    if let Some(uid) = new_auth.get("uuid").and_then(|v| v.as_str()) {
        for acc in &mut cfg.accounts {
            if acc.id == uid {
                acc.microsoft_auth = Some(new_auth.clone());
            }
        }
    }
    {
        let _g = state.config_lock.lock().await;
        let _ = state.write_config(cfg);
    }

    Ok(())
}

#[tauri::command]
pub async fn login_microsoft(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    emit_status(&app, "Inicjalizacja autoryzacji Microsoft...");

    let auth_url_str = format!(
        "https://login.live.com/oauth20_authorize.srf?client_id={MS_CLIENT_ID}&response_type=code&redirect_uri={}&scope=XboxLive.signin%20offline_access&prompt=select_account",
        urlencoding::encode(MS_REDIRECT_URI)
    );
    let Ok(auth_url) = auth_url_str.parse::<url::Url>() else {
        return Ok(json!({ "success": false, "error": "Błąd budowania URL logowania Microsoft." }));
    };

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let shared_tx: Arc<StdMutex<Option<oneshot::Sender<Result<String, String>>>>> =
        Arc::new(StdMutex::new(Some(tx)));

    let win_label = format!("ms_auth_{}", now_epoch_ms());
    let tx_nav = shared_tx.clone();
    let app_nav = app.clone();
    let label_nav = win_label.clone();

    let popup = match WebviewWindowBuilder::new(&app, &win_label, WebviewUrl::External(auth_url))
        .title("Logowanie Microsoft (Minecraft)")
        .inner_size(520.0, 680.0)
        .center()
        .resizable(true)
        .on_navigation(move |nav_url| {
            let url_str = nav_url.as_str();
            if url_str.starts_with(MS_REDIRECT_URI) {
                let mut code_res: Option<String> = None;
                let mut err_res: Option<String> = None;
                for (k, v) in nav_url.query_pairs() {
                    if k == "code" {
                        code_res = Some(v.into_owned());
                    } else if k == "error_description" || k == "error" {
                        if err_res.is_none() {
                            err_res = Some(v.into_owned());
                        }
                    }
                }

                if let Ok(mut guard) = tx_nav.lock() {
                    if let Some(sender) = guard.take() {
                        if let Some(code) = code_res {
                            let _ = sender.send(Ok(code));
                        } else {
                            let _ = sender.send(Err(err_res
                                .unwrap_or_else(|| "Anulowano logowanie Microsoft.".to_string())));
                        }
                    }
                }

                if let Some(win) = app_nav.get_webview_window(&label_nav) {
                    let _ = win.close();
                }
                return false;
            }
            true
        })
        .build()
    {
        Ok(w) => w,
        Err(e) => {
            let msg = format!("Nie udało się otworzyć okna logowania Microsoft: {e}");
            state.log_to_file(&format!("[ERROR] {msg}"));
            return Ok(json!({ "success": false, "error": msg }));
        }
    };

    let tx_close = shared_tx.clone();
    popup.on_window_event(move |ev| {
        if matches!(ev, WindowEvent::Destroyed) {
            if let Ok(mut guard) = tx_close.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Err("Okno logowania zostało zamknięte.".to_string()));
                }
            }
        }
    });

    let code = match rx.await {
        Ok(Ok(c)) => c,
        Ok(Err(err_msg)) => {
            state.log_to_file(&format!("[ERROR] Błąd logowania Microsoft: {err_msg}"));
            return Ok(json!({ "success": false, "error": err_msg }));
        }
        Err(_) => {
            return Ok(json!({ "success": false, "error": "Anulowano logowanie Microsoft." }));
        }
    };

    let form_params = [
        ("client_id", MS_CLIENT_ID),
        ("code", code.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", MS_REDIRECT_URI),
    ];

    let new_auth = match exchange_ms_token_for_mc(&state.http_client, &form_params, Some(&app)).await
    {
        Ok(a) => a,
        Err(e) => {
            state.log_to_file(&format!("[ERROR] Błąd logowania Microsoft: {e}"));
            return Ok(json!({ "success": false, "error": e }));
        }
    };

    let uuid = new_auth
        .get("uuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let name = new_auth
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    {
        let _guard = state.config_lock.lock().await;
        let mut cfg = state.read_config();
        cfg.login_type = "microsoft".to_string();
        cfg.nickname = name.clone();
        cfg.microsoft_auth = Some(new_auth.clone());

        let new_acc = AccountEntry {
            id: uuid.clone(),
            account_type: "microsoft".to_string(),
            nickname: name.clone(),
            microsoft_auth: Some(new_auth),
        };
        if let Some(pos) = cfg.accounts.iter().position(|a| a.id == uuid) {
            cfg.accounts[pos] = new_acc;
            cfg.active_account_index = pos;
        } else {
            cfg.accounts.push(new_acc);
            cfg.active_account_index = cfg.accounts.len() - 1;
        }

        if let Err(e) = state.write_config(&cfg) {
            return Ok(json!({ "success": false, "error": e }));
        }
    }

    emit_status(&app, format!("Zalogowano pomyślnie jako {name}!"));
    Ok(json!({ "success": true, "profile": { "name": name, "uuid": uuid } }))
}


/**
 * github-updater.js
 * Moduł aktualizatora launchera dla Ciapongi RP.
 * Źródło aktualizacji: ciapongi.szablix.pl (z rezerwowym fallbackiem na GitHub API).
 */

const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

// Główny serwer aktualizacji
const SERVER_BASE = 'https://ciapongi.szablix.pl';
const LAUNCHER_API_ENDPOINTS = [
  `${SERVER_BASE}/launcher/latest.json`,
  `${SERVER_BASE}/launcher`
];

// Rezerwowe repozytorium GitHub
const GITHUB_OWNER = 'PotatoePotatoePotatoe';
const GITHUB_REPO  = 'Ciapongi-launcher';

// Porównanie wersji semver (remote > local -> true)
function isNewerVersion(remoteTag, localVersion) {
  if (!remoteTag || !localVersion) return false;
  const clean = (v) => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const remote = clean(remoteTag);
  const local  = clean(localVersion);
  for (let i = 0; i < Math.max(remote.length, local.length, 3); i++) {
    const r = remote[i] || 0;
    const l = local[i]  || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

// Wybór właściwego assetu dla platformy
function pickAsset(assets) {
  if (!Array.isArray(assets)) return null;
  if (process.platform === 'win32') {
    const setup    = assets.find(a => a.name && a.name.includes('Setup') && a.name.endsWith('.exe'));
    const portable = assets.find(a => a.name && !a.name.includes('Setup') && a.name.endsWith('.exe'));
    return setup || portable || null;
  }
  if (process.platform === 'linux') {
    // Priorytet dla AppImage — jedyny format wspierający bezpośrednią podmianę w locie na Linuksie
    const appImage = assets.find(a => a.name && a.name.endsWith('.AppImage'));
    if (appImage) return appImage;
    return assets.find(a => a.name && a.name.endsWith('.tar.gz')) || null;
  }
  return null;
}

// Pomocnicze pobieranie JSON przez HTTP/HTTPS
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': `${GITHUB_REPO}-updater/${app.getVersion()}`,
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 8000
    };

    const req = client.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return fetchJson(redirectUrl).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Błąd parsowania JSON: ' + e.message));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout żądania'));
    });
    req.on('error', reject);
  });
}

// Pobieranie pliku z URL ze streamingiem i callbackiem postępu (ciapongi.szablix.pl lub GitHub)
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    function doRequest(reqUrl, redirects) {
      if (redirects > 10) { reject(new Error('Zbyt wiele przekierowań')); return; }
      const isHttps = reqUrl.startsWith('https:');
      const client = isHttps ? https : http;
      const options = {
        headers: {
          'User-Agent': `${GITHUB_REPO}-updater/${app.getVersion()}`,
          'Accept': 'application/octet-stream, */*',
        }
      };
      client.get(reqUrl, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, reqUrl).toString();
          doRequest(redirectUrl, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0 && onProgress) onProgress(Math.round((downloaded / total) * 100));
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(destPath); });
        res.on('error', (err) => {
          file.close();
          try { fs.unlinkSync(destPath); } catch (_) {}
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(err);
      });
    }

    doRequest(url, 0);
  });
}

// Pobierz dane o najnowszym release (najpierw ciapongi.szablix.pl, fallback: GitHub)
async function fetchRelease(logToFile) {
  const log = logToFile || console.log;

  // 1. Sprawdź serwer ciapongi.szablix.pl
  for (const endpoint of LAUNCHER_API_ENDPOINTS) {
    try {
      log(`[Updater] Sprawdzanie aktualizacji launchera na ${endpoint}...`);
      const data = await fetchJson(endpoint);
      if (data && (data.tag_name || data.version)) {
        log(`[Updater] Otrzymano dane wersji z ciapongi.szablix.pl (${data.tag_name || data.version})`);

        let assets = [];
        if (Array.isArray(data.assets)) {
          assets = data.assets;
        } else if (Array.isArray(data.files)) {
          assets = data.files;
        } else if (data.filename) {
          assets = [{
            name: data.filename,
            browser_download_url: data.downloadUrl || `${SERVER_BASE}/launcher/${encodeURIComponent(data.filename)}`
          }];
        }

        // Normalizacja URL-i assetów
        assets = assets.map(asset => {
          let assetUrl = asset.browser_download_url || asset.url || asset.download_url;
          if (assetUrl && !assetUrl.startsWith('http')) {
            assetUrl = `${SERVER_BASE}${assetUrl.startsWith('/') ? '' : '/'}${assetUrl}`;
          }
          return {
            name: asset.name || asset.filename || '',
            browser_download_url: assetUrl
          };
        });

        return {
          tag_name: data.tag_name || (data.version.startsWith('v') ? data.version : `v${data.version}`),
          body: data.body || data.releaseNotes || data.changelog || 'Nowa aktualizacja launchera na ciapongi.szablix.pl',
          assets: assets,
          source: 'ciapongi.szablix.pl'
        };
      }
    } catch (err) {
      log(`[Updater] Endpoint ${endpoint} niedostępny (${err.message}).`);
    }
  }

  // 2. Rezerwowy fallback: GitHub API
  log(`[Updater] Sprawdzanie rezerwowego źródła na GitHub Releases...`);
  const ghUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const ghData = await fetchJson(ghUrl);
  return {
    ...ghData,
    source: 'github'
  };
}

/**
 * Główna funkcja sprawdzająca aktualizacje launchera.
 * @param {Function} sendEvent  callback IPC do renderera
 * @param {boolean}  autoDownload  czy pobierać automatycznie
 * @param {Function} logToFile  funkcja logowania
 */
async function checkForUpdates(sendEvent, autoDownload, logToFile, isGameRunning) {
  const log = logToFile || console.log;
  if (!app.isPackaged) {
    log('[Updater] Dev mode — updater disabled.');
    return;
  }

  sendEvent({ status: 'checking' });
  log('[Updater] Sprawdzanie aktualizacji launchera (ciapongi.szablix.pl / GitHub)...');

  let releaseData;
  try {
    releaseData = await fetchRelease(log);
  } catch (err) {
    log('[Updater] Błąd pobierania danych o wersji: ' + err.message);
    sendEvent({ status: 'error', error: 'Nie udało się sprawdzić aktualizacji: ' + err.message });
    return;
  }

  const remoteTag    = releaseData.tag_name;
  const localVersion = app.getVersion();
  log(`[Updater] Wersja zdalna: ${remoteTag} | Lokalna: v${localVersion} (źródło: ${releaseData.source || 'remote'})`);

  if (!isNewerVersion(remoteTag, localVersion)) {
    log('[Updater] Brak nowszej wersji. Launcher jest aktualny.');
    sendEvent({ status: 'not-available', info: { version: localVersion } });
    return;
  }

  const asset = pickAsset(releaseData.assets);
  if (!asset) {
    log('[Updater] Brak pasującego pliku instalacyjnego dla tej platformy.');
    sendEvent({ status: 'error', error: 'Brak kompatybilnego pliku aktualizacji dla tego systemu.' });
    return;
  }

  log(`[Updater] Dostępna aktualizacja: ${remoteTag} (plik: ${asset.name})`);
  sendEvent({
    status: 'available',
    info: {
      version: remoteTag.replace(/^v/, ''),
      assetName: asset.name,
      releaseNotes: releaseData.body || ''
    }
  });

  if (autoDownload) {
    const downloadedPath = await startDownload(asset, sendEvent, log);
    if (downloadedPath) {
      const gameRunning = typeof isGameRunning === 'function' ? isGameRunning() : false;
      // Na Linuksie, gdy to AppImage i gra nie jest włączona, aktualizujemy i restartujemy automatycznie!
      if (process.platform === 'linux' && (process.env.APPIMAGE || downloadedPath.endsWith('.AppImage'))) {
        if (!gameRunning) {
          log('[Updater] Auto-update Linux: aktualizacja pobrana, automatyczna instalacja i restart...');
          sendEvent({ status: 'installing', version: remoteTag.replace(/^v/, '') });
          setTimeout(() => {
            installUpdate(downloadedPath, log);
          }, 800);
        } else {
          log('[Updater] Gra jest uruchomiona — instalacja aktualizacji odłożona do jej zamknięcia.');
        }
      }
    }
  }
}

// Zapamiętaj ścieżkę do pobranego pliku
let downloadedFilePath = null;

async function startDownload(asset, sendEvent, logToFile) {
  const log = logToFile || console.log;
  const tmpDir   = os.tmpdir();
  const destPath = path.join(tmpDir, asset.name);

  log('[Updater] Pobieranie aktualizacji: ' + asset.name + ' z ' + asset.browser_download_url);

  try {
    await downloadFile(asset.browser_download_url, destPath, (percent) => {
      sendEvent({ status: 'downloading', progress: percent });
    });
    downloadedFilePath = destPath;
    log('[Updater] Pobieranie zakończone: ' + destPath);
    sendEvent({ status: 'downloaded', filePath: destPath, assetName: asset.name });
    return destPath;
  } catch (err) {
    log('[Updater] Błąd pobierania: ' + err.message);
    sendEvent({ status: 'error', error: 'Błąd pobierania: ' + err.message });
    return null;
  }
}

/**
 * Instaluje pobraną aktualizację.
 * Windows: otwiera instalator NSIS przez shell.openPath (wyzwala UAC) i zamyka launcher.
 * Linux (AppImage): podmienia aktualny plik i restartuje.
 * Linux (inne): otwiera folder z plikiem.
 */
function installUpdate(filePath, logToFile) {
  const log = logToFile || console.log;
  const file = filePath || downloadedFilePath;
  if (!file) {
    log('[Updater] Wywołano instalację, ale brak pobranego pliku.');
    return;
  }
  log('[Updater] Instalowanie aktualizacji: ' + file);

  if (process.platform === 'win32') {
    // shell.openPath poprawnie wyzwala UAC i pokazuje okienko instalatora
    shell.openPath(file).then((errMsg) => {
      if (errMsg) {
        log('[Updater] Błąd shell.openPath: ' + errMsg);
        return;
      }
      // Daj instalatorowi 1.5s na start zanim zamkniemy launcher
      setTimeout(() => app.exit(0), 1500);
    });
  } else if (process.platform === 'linux' && (process.env.APPIMAGE || file.endsWith('.AppImage'))) {
    // Bezpieczna atomowa podmiana AppImage na Linuxie bez błędu ETXTBSY i EXDEV
    try {
      let currentAppImage = process.env.APPIMAGE;
      if (!currentAppImage && process.env.ARGV0 && process.env.ARGV0.endsWith('.AppImage') && fs.existsSync(process.env.ARGV0)) {
        currentAppImage = process.env.ARGV0;
      }

      if (!currentAppImage || !fs.existsSync(currentAppImage)) {
        log('[Updater] Brak ścieżki do obecnego pliku AppImage, otwieram pobrany plik w folderze: ' + file);
        shell.showItemInFolder(file);
        return;
      }

      try {
        currentAppImage = fs.realpathSync(currentAppImage);
      } catch (_) {}

      log(`[Updater] Bezpieczna podmiana AppImage: ${currentAppImage} z pobranego ${file}`);

      const targetDir = path.dirname(currentAppImage);
      const targetTemp = path.join(targetDir, `.${path.basename(currentAppImage)}.update-${Date.now()}`);

      // 1. Kopiujemy plik do tego samego katalogu docelowego (omija błąd EXDEV cross-device link)
      fs.copyFileSync(file, targetTemp);
      fs.chmodSync(targetTemp, 0o755);

      // 2. Unlink starego pliku + atomic rename nowego (omija błąd jądra Linux ETXTBSY: Text file busy)
      try {
        fs.unlinkSync(currentAppImage);
      } catch (uErr) {
        log('[Updater] Informacja unlinkSync starego AppImage: ' + uErr.message);
      }
      fs.renameSync(targetTemp, currentAppImage);
      fs.chmodSync(currentAppImage, 0o755);

      // 3. Czyszczenie pobranego pliku z /tmp
      try {
        if (file !== currentAppImage && fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (_) {}

      log('[Updater] Plik AppImage został pomyślnie podmieniony! Restartowanie launchera...');

      // 4. Uruchomienie zaktualizowanego AppImage w wyczyszczonym środowisku AppImage
      const { spawn } = require('child_process');
      const cleanEnv = { ...process.env };
      delete cleanEnv.APPDIR;
      delete cleanEnv.OWD;

      const child = spawn(currentAppImage, process.argv.slice(1), {
        detached: true,
        stdio: 'ignore',
        env: cleanEnv
      });
      child.unref();

      setTimeout(() => {
        app.exit(0);
      }, 300);
    } catch (err) {
      log('[Updater] Błąd podczas podmiany AppImage: ' + err.message);
      shell.showItemInFolder(file);
    }
  } else {
    shell.showItemInFolder(file);
  }
}

function getDownloadedUpdate() {
  return downloadedFilePath;
}

module.exports = { checkForUpdates, startDownload, installUpdate, fetchRelease, pickAsset, getDownloadedUpdate };

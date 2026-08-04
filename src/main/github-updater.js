/**
 * github-updater.js
 * Niezalezny od electron-updater modul aktualizatora.
 * Nie wymaga pliku latest.yml — odpytuje bezposrednio GitHub API.
 */

const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFile } = require('child_process');

const GITHUB_OWNER = 'PotatoePotatoePotatoe';
const GITHUB_REPO  = 'Ciapongi-launcher';

// Porownanie wersji semver (remote > local -> true)
function isNewerVersion(remoteTag, localVersion) {
  const clean = (v) => v.replace(/^v/, '').split('.').map(Number);
  const remote = clean(remoteTag);
  const local  = clean(localVersion);
  for (let i = 0; i < 3; i++) {
    const r = remote[i] || 0;
    const l = local[i]  || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

// Wybor wlasciwego assetu dla platformy
function pickAsset(assets) {
  if (process.platform === 'win32') {
    const setup    = assets.find(a => a.name.includes('Setup') && a.name.endsWith('.exe'));
    const portable = assets.find(a => !a.name.includes('Setup') && a.name.endsWith('.exe'));
    return setup || portable || null;
  }
  if (process.platform === 'linux') {
    return assets.find(a => a.name.endsWith('.tar.gz') || a.name.endsWith('.AppImage')) || null;
  }
  return null;
}

// Pobieranie pliku z GitHub ze streamingiem i callbackiem postepu
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    function doRequest(reqUrl, redirects) {
      if (redirects > 10) { reject(new Error('Zbyt wiele przekierowan')); return; }
      const options = {
        headers: {
          'User-Agent': GITHUB_REPO + '-updater/' + app.getVersion(),
          'Accept': 'application/octet-stream',
        }
      };
      https.get(reqUrl, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirects + 1);
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
        res.on('error', reject);
      }).on('error', reject);
    }

    doRequest(url, 0);
  });
}

// Pobierz dane o najnowszym release z GitHub API
function fetchRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest',
      headers: {
        'User-Agent': GITHUB_REPO + '-updater/' + app.getVersion(),
        'Accept': 'application/vnd.github.v3+json',
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error('GitHub API HTTP ' + res.statusCode)); return; }
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Blad parsowania GitHub API')); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Glowna funkcja sprawdzajaca aktualizacje.
 * @param {Function} sendEvent  callback IPC do renderera
 * @param {boolean}  autoDownload  czy pobierac automatycznie
 * @param {Function} logToFile  funkcja logowania
 */
async function checkForUpdates(sendEvent, autoDownload, logToFile) {
  if (!app.isPackaged) {
    logToFile('[GithubUpdater] Dev mode — updater disabled.');
    return;
  }

  sendEvent({ status: 'checking' });
  logToFile('[GithubUpdater] Checking for updates via GitHub API...');

  let releaseData;
  try {
    releaseData = await fetchRelease();
  } catch (err) {
    logToFile('[GithubUpdater] Error fetching release: ' + err.message);
    sendEvent({ status: 'error', error: 'Nie udalo sie polaczyc z GitHub: ' + err.message });
    return;
  }

  const remoteTag    = releaseData.tag_name;
  const localVersion = app.getVersion();
  logToFile('[GithubUpdater] Remote: ' + remoteTag + ' | Local: v' + localVersion);

  if (!isNewerVersion(remoteTag, localVersion)) {
    logToFile('[GithubUpdater] No update available.');
    sendEvent({ status: 'not-available', info: { version: localVersion } });
    return;
  }

  const asset = pickAsset(releaseData.assets);
  if (!asset) {
    logToFile('[GithubUpdater] No compatible asset found for this platform.');
    sendEvent({ status: 'error', error: 'Brak kompatybilnego pliku aktualizacji dla tego systemu.' });
    return;
  }

  logToFile('[GithubUpdater] Update available: ' + remoteTag + ' (asset: ' + asset.name + ')');
  sendEvent({
    status: 'available',
    info: {
      version: remoteTag.replace(/^v/, ''),
      assetName: asset.name,
      releaseNotes: releaseData.body || ''
    }
  });

  if (autoDownload) {
    await startDownload(asset, sendEvent, logToFile);
  }
}

// Zapamiętaj ścieżkę do pobranego pliku
let downloadedFilePath = null;

async function startDownload(asset, sendEvent, logToFile) {
  const tmpDir   = os.tmpdir();
  const destPath = path.join(tmpDir, asset.name);

  logToFile('[GithubUpdater] Downloading: ' + asset.name);

  try {
    await downloadFile(asset.browser_download_url, destPath, (percent) => {
      sendEvent({ status: 'downloading', progress: percent });
    });
    downloadedFilePath = destPath;
    logToFile('[GithubUpdater] Download complete: ' + destPath);
    sendEvent({ status: 'downloaded', filePath: destPath, assetName: asset.name });
  } catch (err) {
    logToFile('[GithubUpdater] Download error: ' + err.message);
    sendEvent({ status: 'error', error: 'Blad pobierania: ' + err.message });
  }
}

/**
 * Instaluje pobrana aktualizacje.
 * Windows: uruchamia instalator NSIS i zamyka launcher.
 * Linux: otwiera folder z plikiem.
 */
function installUpdate(filePath, logToFile) {
  const file = filePath || downloadedFilePath;
  if (!file) {
    logToFile('[GithubUpdater] Install called but no file downloaded.');
    return;
  }
  logToFile('[GithubUpdater] Installing update: ' + file);
  if (process.platform === 'win32') {
    const { spawn } = require('child_process');
    // Dodajemy opóźnienie 1-2 sekundy, aby launcher zdążył całkowicie się zamknąć i zwolnić pliki.
    const command = `timeout /T 2 /NOBREAK > nul & "${file}" /S`;
    const child = spawn('cmd.exe', ['/c', command], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    app.exit(0);
  } else {
    shell.showItemInFolder(file);
  }
}

module.exports = { checkForUpdates, startDownload, installUpdate, fetchRelease, pickAsset };

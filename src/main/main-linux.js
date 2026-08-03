const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Client } = require('minecraft-launcher-core');
const { pathToFileURL } = require('url');
const githubUpdater = require('./github-updater');
const { Auth } = require('msmc');

// Główna konfiguracja i okno
let mainWindow = null;
let minecraftProcess = null;

// Katalog bazowy aplikacji dla Linuxa
const appBaseDir = process.env.APPIMAGE
  ? path.dirname(process.env.APPIMAGE)
  : (app.isPackaged ? app.getPath('userData') : app.getAppPath());

const configPath = path.join(appBaseDir, 'launcher-config-local.json');
const defaultGameDir = path.join(appBaseDir, 'minecraft-instance');
const logPath = path.join(appBaseDir, 'launcher-latest.log');

// Pomocnicza funkcja zapisująca logi do pliku
function logToFile(message) {
  try {
    fs.appendFileSync(logPath, message + '\n', 'utf8');
  } catch (err) {
    console.error("Błąd zapisu logu do pliku:", err);
  }
}

// Domyślna konfiguracja launchera
const DEFAULT_CONFIG = {
  minecraftVersion: "1.20.1",
  loader: "fabric",
  loaderVersion: "0.19.3",
  ram: 4096,
  nickname: "",
  gameDir: defaultGameDir,
  githubToken: "",
  javaPath: "",
  javaVersion: "auto",
  potatoMode: false,
  jvmProfile: "auto",
  loginType: "offline",
  microsoftAuth: null,
  packVersion: "",
  disableAutoUpdate: false,
  autoUpdateLauncher: true,
  theme: "dark-violet",
  accounts: [],
  activeAccountIndex: 0
};

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const saved = JSON.parse(data);
      const merged = { ...DEFAULT_CONFIG, ...saved };

      if (!merged.accounts || merged.accounts.length === 0) {
        if (merged.nickname && merged.nickname !== '') {
          merged.accounts = [{
            id: merged.microsoftAuth ? merged.microsoftAuth.uuid : `offline-${merged.nickname}`,
            type: merged.loginType || 'offline',
            nickname: merged.nickname,
            microsoftAuth: merged.microsoftAuth || null
          }];
          merged.activeAccountIndex = 0;
        } else {
          merged.accounts = [];
          merged.activeAccountIndex = 0;
        }
      }
      return merged;
    } else {
      const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
      let defaultRam = 4096;
      let defaultProfile = 'optimized_g1gc';
      if (totalMb <= 4500) {
        defaultRam = 2048;
        defaultProfile = 'ultra_potato';
      } else if (totalMb <= 8500) {
        defaultRam = 4096;
        defaultProfile = 'potato';
      } else if (totalMb <= 12500) {
        defaultRam = 6144;
        defaultProfile = 'optimized_g1gc';
      } else if (totalMb <= 16500) {
        defaultRam = 8192;
        defaultProfile = 'optimized_g1gc';
      } else {
        defaultRam = 10240;
        defaultProfile = 'extreme_zgc';
      }
      return { ...DEFAULT_CONFIG, ram: defaultRam, jvmProfile: defaultProfile };
    }
  } catch (err) {
    console.error("Błąd odczytu config.json:", err);
  }
  return { ...DEFAULT_CONFIG };
}

function writeConfig(config) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error("Błąd zapisu config.json:", err);
  }
}

function findJavaExecutable(dir) {
  if (!fs.existsSync(dir)) return null;
  const items = fs.readdirSync(dir);
  const isWin = process.platform === 'win32';
  const matchName = isWin ? 'java.exe' : 'java';

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findJavaExecutable(fullPath);
      if (found) return found;
    } else if (item.toLowerCase() === matchName) {
      return fullPath;
    }
  }
  return null;
}

async function downloadFile(url, destPath, onProgress, headers = {}) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    headers
  });

  const totalLength = parseInt(response.headers['content-length'] || '0', 10);
  let downloadedLength = 0;
  const startTime = Date.now();
  let lastTime = startTime;
  let lastDownloaded = 0;
  let currentSpeed = 0;

  response.data.on('data', (chunk) => {
    downloadedLength += chunk.length;
    const now = Date.now();

    if (now - lastTime >= 500) {
      const timeElapsed = (now - lastTime) / 1000;
      const bytesSinceLast = downloadedLength - lastDownloaded;
      currentSpeed = bytesSinceLast / timeElapsed;
      lastTime = now;
      lastDownloaded = downloadedLength;
    }

    if (onProgress) {
      const progress = totalLength > 0 ? Math.round((downloadedLength / totalLength) * 100) : 0;
      onProgress({
        progress,
        transferred: downloadedLength,
        total: totalLength,
        speed: currentSpeed || (downloadedLength / ((now - startTime) / 1000 || 1))
      });
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function copyDirRecursive(src, dest, relativeList = [], baseDest = dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (['saves', 'screenshots', 'logs'].includes(entry.name.toLowerCase())) {
        continue;
      }
      copyDirRecursive(srcPath, destPath, relativeList, baseDest);
    } else {
      fs.copyFileSync(srcPath, destPath);
      const rel = path.relative(baseDest, destPath).replace(/\\/g, '/');
      relativeList.push(rel);
    }
  }
  return relativeList;
}

function findPackRoot(dir) {
  const items = fs.readdirSync(dir);
  if (items.includes('mods') || items.includes('config') || items.includes('launcher-config.json')) {
    return dir;
  }
  for (const item of items) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      const subRoot = findPackRoot(fullPath);
      if (subRoot) return subRoot;
    }
  }
  return null;
}

function isPackFullyInstalled(gameDir) {
  const manifestPath = path.join(gameDir, 'pack-manifest.json');
  const modsDir = path.join(gameDir, 'mods');

  if (!fs.existsSync(manifestPath) || !fs.existsSync(modsDir)) {
    return false;
  }

  try {
    const manifestFiles = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(manifestFiles) || manifestFiles.length < 5) {
      return false;
    }

    const manifestFilesExist = manifestFiles.every(file => fs.existsSync(path.join(gameDir, file)));
    if (!manifestFilesExist) {
      return false;
    }

    const modFiles = fs.readdirSync(modsDir).map(f => f.toLowerCase());
    const hasFabricApi = modFiles.some(f => f.includes('fabric-api') || f.includes('fabric_api'));
    const hasSodium = modFiles.some(f => f.includes('sodium'));
    const hasMtr = modFiles.some(f => f.includes('mtr') || f.includes('minecraft-transit-railway'));

    if (!hasFabricApi || !hasSodium || !hasMtr) {
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

function sendUpdateEvent(data) {
  if (mainWindow) mainWindow.webContents.send('launcher-update-event', data);
}

function setupLauncherUpdater() {
  if (!app.isPackaged) {
    logToFile('[GithubUpdater] Dev mode — updater disabled.');
    return;
  }
  const config = readConfig();
  const autoDownload = config.autoUpdateLauncher !== false;
  githubUpdater.checkForUpdates(sendUpdateEvent, autoDownload, logToFile)
    .catch(err => logToFile('[GithubUpdater] Init check error: ' + err));
}

ipcMain.handle('check-for-launcher-updates', async () => {
  try {
    const config = readConfig();
    const autoDownload = config.autoUpdateLauncher !== false;
    await githubUpdater.checkForUpdates(sendUpdateEvent, autoDownload, logToFile);
    return { success: true };
  } catch (err) {
    logToFile('[GithubUpdater] Manual check error: ' + err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-launcher-update', () => {
  try {
    githubUpdater.installUpdate(null, logToFile);
    return { success: true };
  } catch (err) {
    logToFile('[GithubUpdater] Install error: ' + err);
    return { success: false, error: err.message };
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    title: "Ciapongi-RP Launcher",
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      setTimeout(() => {
        mainWindow.loadURL('http://localhost:5173');
      }, 1000);
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'mc-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

app.whenReady().then(() => {
  protocol.handle('mc-file', (request) => {
    try {
      const urlPath = request.url.slice('mc-file://'.length);
      const decodedPath = decodeURIComponent(urlPath);
      const config = readConfig();
      const gameDir = config.gameDir;
      const resolvedPath = path.resolve(gameDir, decodedPath);

      if (resolvedPath.startsWith(gameDir)) {
        return net.fetch(pathToFileURL(resolvedPath).toString());
      }
    } catch (e) {
      console.error("Błąd protokołu mc-file:", e);
    }
    return new Response('Access denied', { status: 403 });
  });

  createWindow();
  setupLauncherUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-screenshots', async () => {
  const config = readConfig();
  const gameDir = config.gameDir;
  const screenshotsDir = path.join(gameDir, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    return [];
  }
  try {
    const files = fs.readdirSync(screenshotsDir);
    const screenshots = [];
    for (const file of files) {
      if (/\.(png|jpg|jpeg)$/i.test(file)) {
        const filePath = path.join(screenshotsDir, file);
        const stats = fs.statSync(filePath);
        screenshots.push({
          filename: file,
          url: `mc-file://screenshots/${encodeURIComponent(file)}`,
          created: stats.birthtimeMs || stats.mtimeMs,
          size: stats.size
        });
      }
    }
    return screenshots.sort((a, b) => b.created - a.created);
  } catch (err) {
    console.error("Błąd pobierania zrzutów ekranu:", err);
    return [];
  }
});

ipcMain.handle('delete-screenshot', async (event, filename) => {
  const config = readConfig();
  const gameDir = config.gameDir;
  const filePath = path.join(gameDir, 'screenshots', filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'Plik nie istnieje.' };
  } catch (err) {
    console.error("Błąd usuwania zrzutu ekranu:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-config', () => {
  return readConfig();
});

ipcMain.handle('open-logs', async () => {
  const { shell } = require('electron');
  if (fs.existsSync(logPath)) {
    await shell.openPath(logPath);
    return { success: true };
  }
  return { success: false, error: 'Brak pliku logów.' };
});

ipcMain.handle('save-config', (event, config) => {
  writeConfig(config);
  return { success: true };
});

ipcMain.handle('get-system-ram', () => {
  const totalBytes = os.totalmem();
  return Math.floor(totalBytes / (1024 * 1024));
});

ipcMain.handle('get-system-specs', () => {
  try {
    const cpus = os.cpus();
    const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : 'Nieznany procesor';
    const cpuCores = cpus ? cpus.length : 1;
    const totalBytes = os.totalmem();
    const totalRamMb = Math.floor(totalBytes / (1024 * 1024));

    let gpuName = 'Nieznana karta graficzna';
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        const output = execSync('powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', { encoding: 'utf8' });
        if (output && output.trim()) {
          const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            gpuName = lines[lines.length - 1];
          }
        }
      } else {
        const output = execSync("lspci | grep -i -E 'vga|3d|display'", { encoding: 'utf8' });
        if (output && output.trim()) {
          const parts = output.split(':');
          if (parts.length > 2) {
            gpuName = parts[2].trim();
          } else {
            gpuName = output.trim();
          }
        }
      }
    } catch (e) {
      console.error("Błąd pobierania GPU:", e.message);
    }

    return {
      cpu: cpuModel,
      cores: cpuCores,
      ram: totalRamMb,
      gpu: gpuName
    };
  } catch (err) {
    console.error("Błąd pobierania specyfikacji systemu:", err);
    return {
      cpu: 'Nieznany procesor',
      cores: 1,
      ram: 4096,
      gpu: 'Nieznana karta graficzna'
    };
  }
});

ipcMain.handle('get-server-status', async () => {
  try {
    const res = await axios.get('https://api.mcsrvstat.us/3/ciapongi.szablix.pl', { timeout: 8000 });
    if (res.data) {
      return {
        online: !!res.data.online,
        players: res.data.players ? {
          online: res.data.players.online || 0,
          max: res.data.players.max || 100
        } : { online: 0, max: 100 },
        version: res.data.version || 'Fabric 1.20.1',
        motd: res.data.motd && res.data.motd.clean ? res.data.motd.clean.join('\n') : 'Ciapongi RP'
      };
    }
    return { online: false, players: { online: 0, max: 100 }, version: 'Fabric 1.20.1', motd: '' };
  } catch (err) {
    console.error("Błąd pobierania statusu serwera:", err);
    return { online: false, players: { online: 0, max: 100 }, version: 'Fabric 1.20.1', motd: '' };
  }
});

ipcMain.handle('open-folder', async (event, subfolder) => {
  const { shell } = require('electron');
  const config = readConfig();
  let targetPath = config.gameDir;

  if (subfolder === 'mods') {
    targetPath = path.join(targetPath, 'mods');
  } else if (subfolder === 'saves') {
    targetPath = path.join(targetPath, 'saves');
  } else if (subfolder === 'screenshots') {
    targetPath = path.join(targetPath, 'screenshots');
  }

  try {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    await shell.openPath(targetPath);
    return { success: true };
  } catch (err) {
    console.error(`Błąd podczas otwierania katalogu ${targetPath}:`, err);
    return { success: false, error: err.message };
  }
});

// LOGOWANIE MICROSOFT (ZA POMOCĄ MSMC)
ipcMain.handle('login-microsoft', async () => {
  try {
    mainWindow.webContents.send('status-message', 'Inicjalizacja autoryzacji Microsoft...');
    const authManager = new Auth("select_account");

    const xboxManager = await authManager.launch("electron");
    mainWindow.webContents.send('status-message', 'Pobieranie profilu Minecraft...');
    const token = await xboxManager.getMinecraft();

    if (!token || !token.mclc()) {
      return { success: false, error: 'Nie udało się pobrać profilu Minecraft.' };
    }

    const profile = token.mclc();

    const newAuth = {
      uuid: profile.uuid,
      name: profile.name,
      access_token: profile.access_token,
      profile: profile
    };

    const config = readConfig();
    config.loginType = 'microsoft';
    config.nickname = profile.name;
    config.microsoftAuth = newAuth;

    if (!config.accounts) config.accounts = [];
    const existingIdx = config.accounts.findIndex(a => a.id === profile.uuid);
    const newAccount = { id: profile.uuid, type: 'microsoft', nickname: profile.name, microsoftAuth: newAuth };

    if (existingIdx >= 0) {
      config.accounts[existingIdx] = newAccount;
      config.activeAccountIndex = existingIdx;
    } else {
      config.accounts.push(newAccount);
      config.activeAccountIndex = config.accounts.length - 1;
    }

    writeConfig(config);

    mainWindow.webContents.send('status-message', `Zalogowano pomyślnie jako ${profile.name}!`);
    return { success: true, profile: { name: profile.name, uuid: profile.uuid } };
  } catch (err) {
    logToFile(`[ERROR] Błąd logowania Microsoft (msmc): ${err.message}`);
    return { success: false, error: err.message || 'Anulowano lub wystąpił błąd logowania.' };
  }
});

ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Wybierz folder instalacyjny gry'
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('add-server-to-minecraft', async () => {
  try {
    const config = readConfig();
    const gameDir = config.gameDir;
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }
    const serversDatPath = path.join(gameDir, 'servers.dat');

    const SERVER_NAME = 'Ciapongi-RP';
    const SERVER_IP = 'ciapongi.szablix.pl';

    function writeNBTString(str) {
      const buf = Buffer.from(str, 'utf8');
      const lenBuf = Buffer.alloc(2);
      lenBuf.writeUInt16BE(buf.length, 0);
      return Buffer.concat([lenBuf, buf]);
    }
    function writeNBTCompound(entries) {
      const chunks = [];
      for (const entry of entries) {
        chunks.push(Buffer.from([entry.tagType]));
        chunks.push(writeNBTString(entry.name));
        chunks.push(entry.value);
      }
      chunks.push(Buffer.from([0]));
      return Buffer.concat(chunks);
    }

    function nbtByte(val) { const b = Buffer.alloc(1); b.writeUInt8(val, 0); return b; }
    function nbtString(str) { return writeNBTString(str); }

    const serverCompound = writeNBTCompound([
      { tagType: 8, name: 'name', value: nbtString(SERVER_NAME) },
      { tagType: 8, name: 'ip', value: nbtString(SERVER_IP) },
      { tagType: 1, name: 'hideAddress', value: nbtByte(0) }
    ]);

    const listPayload = Buffer.alloc(5);
    listPayload.writeUInt8(10, 0);
    listPayload.writeInt32BE(1, 1);
    const serversList = Buffer.concat([listPayload, serverCompound]);

    const rootCompound = writeNBTCompound([
      { tagType: 9, name: 'servers', value: serversList }
    ]);

    const header = Buffer.concat([
      Buffer.from([10]),
      Buffer.from([0, 0]),
      rootCompound
    ]);

    if (fs.existsSync(serversDatPath)) {
      const existing = fs.readFileSync(serversDatPath);
      if (existing.includes(SERVER_IP)) {
        logToFile('[SYSTEM] Serwer Ciapongi-RP już istnieje w servers.dat — pomijanie zapisu.');
        return { success: true, alreadyExists: true };
      }
    }

    fs.writeFileSync(serversDatPath, header);
    logToFile(`[SYSTEM] Zapisano servers.dat z serwerem ${SERVER_IP}`);
    return { success: true };
  } catch (err) {
    console.error('Błąd zapisu servers.dat:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('add-account', async (event, { type, nickname, microsoftAuth }) => {
  const config = readConfig();
  if (!config.accounts) config.accounts = [];

  const id = type === 'microsoft' && microsoftAuth ? microsoftAuth.uuid : `offline-${nickname}`;

  const existingIdx = config.accounts.findIndex(a => a.id === id);
  const newAccount = { id, type, nickname, microsoftAuth: microsoftAuth || null };

  if (existingIdx >= 0) {
    config.accounts[existingIdx] = newAccount;
    config.activeAccountIndex = existingIdx;
  } else {
    config.accounts.push(newAccount);
    config.activeAccountIndex = config.accounts.length - 1;
  }

  config.nickname = newAccount.nickname;
  config.loginType = newAccount.type;
  config.microsoftAuth = newAccount.microsoftAuth;

  writeConfig(config);
  return { success: true, config };
});

ipcMain.handle('switch-account', async (event, { index }) => {
  const config = readConfig();
  if (!config.accounts || index < 0 || index >= config.accounts.length) {
    return { success: false, error: 'Nieprawidłowy indeks konta.' };
  }
  config.activeAccountIndex = index;
  const acc = config.accounts[index];
  config.nickname = acc.nickname;
  config.loginType = acc.type;
  config.microsoftAuth = acc.microsoftAuth || null;
  writeConfig(config);
  return { success: true, config };
});

ipcMain.handle('remove-account', async (event, { index }) => {
  const config = readConfig();
  if (!config.accounts || index < 0 || index >= config.accounts.length) {
    return { success: false, error: 'Nieprawidłowy indeks konta.' };
  }

  config.accounts.splice(index, 1);

  if (config.accounts.length === 0) {
    config.activeAccountIndex = 0;
    config.nickname = 'Gracz';
    config.loginType = 'offline';
    config.microsoftAuth = null;
  } else {
    if (index === config.activeAccountIndex || config.activeAccountIndex >= config.accounts.length) {
      config.activeAccountIndex = 0;
    } else if (index < config.activeAccountIndex) {
      config.activeAccountIndex -= 1;
    }
    const acc = config.accounts[config.activeAccountIndex];
    config.nickname = acc.nickname;
    config.loginType = acc.type;
    config.microsoftAuth = acc.microsoftAuth || null;
  }

  writeConfig(config);
  return { success: true, config };
});

ipcMain.handle('get-pack-versions', async (event) => {
  const config = readConfig();
  const headers = { 'User-Agent': 'Ciapongi-RP-Launcher' };
  if (config.githubToken) {
    headers['Authorization'] = `token ${config.githubToken}`;
  }
  const apiURL = 'https://api.github.com/repos/KrolestwoSZABLIXa/Ciapongi-RP/releases';
  try {
    const res = await axios.get(apiURL, { headers });
    if (!res.data || res.data.length === 0) return [];
    return res.data.map(r => ({
      tag_name: r.tag_name,
      name: r.name || r.tag_name,
      published_at: r.published_at
    }));
  } catch (err) {
    console.error('Błąd pobierania wersji paczki:', err.message);
    return [];
  }
});

ipcMain.handle('sync-pack', async (event, force = false) => {
  const config = readConfig();

  const gameDir = config.gameDir;
  const manifestPath = path.join(gameDir, 'pack-manifest.json');

  if (config.disableAutoUpdate && !force) {
    const isInstalled = isPackFullyInstalled(gameDir);
    if (isInstalled) {
      mainWindow.webContents.send('status-message', 'Automatyczne aktualizacje paczki są wyłączone.');
      mainWindow.webContents.send('pack-sync-progress', { status: 'idle', progress: 100 });
      return { success: true };
    } else {
      mainWindow.webContents.send('status-message', 'Brak plików paczki modów na dysku. Wymuszanie pierwszeństwa pobrania pierwszej instalacji...');
      logToFile('[SYSTEM] Opcja disableAutoUpdate jest włączona, ale paczka nie istnieje na dysku. Pobieranie pierwszej instalacji...');
    }
  }

  const tempDir = path.join(gameDir, 'temp');

  try {
    mainWindow.webContents.send('status-message', 'Sprawdzanie wersji paczki na GitHub...');

    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const headers = { 'User-Agent': 'Ciapongi-RP-Launcher' };
    if (config.githubToken) {
      headers['Authorization'] = `token ${config.githubToken}`;
    }

    const apiURL = 'https://api.github.com/repos/KrolestwoSZABLIXa/Ciapongi-RP/releases';
    let releaseInfo;
    try {
      const res = await axios.get(apiURL, { headers });
      if (!res.data || res.data.length === 0) {
        throw new Error("Brak wydań (releases) w repozytorium.");
      }

      if (config.targetPackVersion && config.targetPackVersion !== 'latest') {
        releaseInfo = res.data.find(r => r.tag_name === config.targetPackVersion);
        if (!releaseInfo) {
          mainWindow.webContents.send('status-message', `Nie znaleziono wersji ${config.targetPackVersion}, pobieranie najnowszej...`);
          releaseInfo = res.data[0];
        }
      } else {
        releaseInfo = res.data[0];
      }
    } catch (err) {
      throw new Error(`Brak połączenia z GitHub API (${err.response?.status === 404 ? 'Repozytorium prywatne lub brak wydań' : err.message})`);
    }

    const latestVersion = releaseInfo.tag_name;
    const isInstalled = isPackFullyInstalled(gameDir);

    if (!force && config.packVersion === latestVersion && isInstalled) {
      mainWindow.webContents.send('status-message', `Paczka jest gotowa (wersja ${latestVersion})`);
      mainWindow.webContents.send('pack-sync-progress', { status: 'idle', progress: 100 });
      return { success: true, updated: false };
    }

    if (!force && config.packVersion === latestVersion && !isInstalled) {
      mainWindow.webContents.send('status-message', 'Coś poszło nie tak z plikami paczki. Launcher naprawia i pobiera brakujące mody...');
      logToFile('[SYSTEM] Wykryto brakujące lub uszkodzone pliki paczki przy zgodnej wersji. Uruchamianie naprawy...');
    } else {
      mainWindow.webContents.send('status-message', `Wykryto nową wersję na serwerze: ${releaseInfo.name || releaseInfo.tag_name}. Przygotowywanie aktualizacji...`);
    }

    let downloadUrl = null;
    const assetZip = releaseInfo.assets.find(a => a.name.endsWith('.zip'));

    if (assetZip) {
      downloadUrl = assetZip.browser_download_url;
      mainWindow.webContents.send('status-message', `Pobieranie najnowszej paczki modyfikacji...`);
    } else {
      downloadUrl = releaseInfo.zipball_url;
      mainWindow.webContents.send('status-message', 'Pobieranie plików paczki...');
    }

    if (!downloadUrl) {
      throw new Error("Nie znaleziono pliku do pobrania w najnowszym wydaniu.");
    }

    const zipPath = path.join(tempDir, 'pack.zip');
    await downloadFile(downloadUrl, zipPath, (progressData) => {
      mainWindow.webContents.send('pack-sync-progress', {
        status: 'downloading',
        progress: progressData.progress,
        transferred: progressData.transferred,
        total: progressData.total,
        speed: progressData.speed
      });
    }, headers);

    mainWindow.webContents.send('status-message', 'Instalowanie modów i konfiguracji w folderze gry...');
    mainWindow.webContents.send('pack-sync-progress', { status: 'extracting', progress: 50 });

    const extractPath = path.join(tempDir, 'extracted');
    if (fs.existsSync(extractPath)) {
      fs.rmSync(extractPath, { recursive: true, force: true });
    }
    fs.mkdirSync(extractPath, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);

    const packRoot = findPackRoot(extractPath);
    if (!packRoot) {
      throw new Error("W archiwum ZIP nie odnaleziono katalogu z modami (mods) ani konfiguracją (config).");
    }

    const innerConfigPath = path.join(packRoot, 'launcher-config.json');
    if (fs.existsSync(innerConfigPath)) {
      try {
        const innerConfig = JSON.parse(fs.readFileSync(innerConfigPath, 'utf8'));
        let updated = false;
        if (innerConfig.minecraftVersion && innerConfig.minecraftVersion !== config.minecraftVersion) {
          config.minecraftVersion = innerConfig.minecraftVersion;
          updated = true;
        }
        if (innerConfig.loaderVersion && innerConfig.loaderVersion !== config.loaderVersion) {
          config.loaderVersion = innerConfig.loaderVersion;
          updated = true;
        }
        if (innerConfig.loader && innerConfig.loader !== config.loader) {
          config.loader = innerConfig.loader;
          updated = true;
        }
        if (updated) {
          writeConfig(config);
        }
      } catch (e) {
        console.error("Błąd podczas czytania launcher-config.json z paczki:", e);
      }
    }

    const disabledPackFiles = new Set();
    const modsDir = path.join(gameDir, 'mods');
    const rpDir = path.join(gameDir, 'resourcepacks');

    if (fs.existsSync(modsDir)) {
      fs.readdirSync(modsDir).filter(f => f.endsWith('.disabled')).forEach(f => {
        disabledPackFiles.add(f.replace(/\.disabled$/, ''));
      });
    }
    if (fs.existsSync(rpDir)) {
      fs.readdirSync(rpDir).filter(f => f.endsWith('.disabled')).forEach(f => {
        disabledPackFiles.add(f.replace(/\.disabled$/, ''));
      });
    }

    mainWindow.webContents.send('status-message', 'Usuwanie niepotrzebnych lub starych plików...');
    if (fs.existsSync(manifestPath)) {
      try {
        const oldFiles = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        for (const file of oldFiles) {
          const fullPath = path.join(gameDir, file);
          const disabledPath = fullPath + '.disabled';
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { force: true });
          }
          if (fs.existsSync(disabledPath)) {
            fs.rmSync(disabledPath, { force: true });
          }
        }
      } catch (err) {
        console.error("Błąd czyszczenia starej paczki:", err);
      }
    }

    const copiedFiles = [];
    copyDirRecursive(packRoot, gameDir, copiedFiles, gameDir);

    if (disabledPackFiles.size > 0) {
      for (const fileRel of copiedFiles) {
        const fullPath = path.join(gameDir, fileRel);
        const baseName = path.basename(fullPath);
        if (disabledPackFiles.has(baseName) && fs.existsSync(fullPath)) {
          const disabledPath = fullPath + '.disabled';
          try {
            if (fs.existsSync(disabledPath)) fs.rmSync(disabledPath, { force: true });
            fs.renameSync(fullPath, disabledPath);
            logToFile(`[SYSTEM] Zachowano wyłączony stan dla pliku paczki: ${baseName}`);
          } catch (e) {
            console.error(`Błąd zachowywania wyłączonego stanu pliku ${baseName}:`, e);
          }
        }
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(copiedFiles, null, 2), 'utf8');

    fs.rmSync(tempDir, { recursive: true, force: true });

    config.packVersion = latestVersion;
    writeConfig(config);

    mainWindow.webContents.send('status-message', 'Wszystko gotowe! Paczka zaktualizowana.');
    mainWindow.webContents.send('pack-sync-progress', { status: 'idle', progress: 100 });
    return { success: true };

  } catch (err) {
    console.error("Błąd synchronizacji paczki:", err);
    mainWindow.webContents.send('status-message', `Błąd: ${err.message}`);
    mainWindow.webContents.send('pack-sync-progress', { status: 'error', error: err.message });
    if (fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-latest-release-notes', async () => {
  const config = readConfig();
  const headers = { 'User-Agent': 'Ciapongi-RP-Launcher' };
  if (config.githubToken) {
    headers['Authorization'] = `token ${config.githubToken}`;
  }
  const apiURL = 'https://api.github.com/repos/KrolestwoSZABLIXa/Ciapongi-RP/releases';
  try {
    const res = await axios.get(apiURL, { headers });
    if (res.data && res.data.length > 0) {
      const latest = res.data[0];
      return {
        tag_name: latest.tag_name,
        name: latest.name || latest.tag_name,
        body: latest.body || 'Brak opisu dla tej wersji.',
        published_at: latest.published_at
      };
    }
  } catch (err) {
    console.error("Błąd pobierania release notes:", err);
  }
  return null;
});

function getMainPackModIds() {
  const config = readConfig();
  const gameDir = config.gameDir;
  const manifestPath = path.join(gameDir, 'pack-manifest.json');
  const mainModIds = new Set();

  if (fs.existsSync(manifestPath)) {
    try {
      const files = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const file of files) {
        if (file.toLowerCase().startsWith('mods/') && file.toLowerCase().endsWith('.jar')) {
          const filePath = path.join(gameDir, file);
          const baseNameClean = path.basename(file, '.jar').toLowerCase().replace(/[^a-z0-9]/g, '');
          mainModIds.add(baseNameClean);

          if (fs.existsSync(filePath)) {
            try {
              const zip = new AdmZip(filePath);
              const zipEntry = zip.getEntry('fabric.mod.json');
              if (zipEntry) {
                const modJson = JSON.parse(zipEntry.getData().toString('utf8'));
                if (modJson.id) {
                  mainModIds.add(modJson.id.toLowerCase().replace(/[^a-z0-9]/g, ''));
                }
                if (modJson.name) {
                  mainModIds.add(modJson.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
                }
              }
            } catch (e) { }
          }
        }
      }
    } catch (err) {
      console.error("Błąd odczytu pack-manifest.json:", err);
    }
  }
  return Array.from(mainModIds);
}

function getFolderForProjectType(gameDir, projectType) {
  if (projectType === 'shader') {
    return path.join(gameDir, 'shaderpacks');
  } else if (projectType === 'resourcepack' || projectType === 'pack-resourcepack') {
    return path.join(gameDir, 'resourcepacks');
  }
  return path.join(gameDir, 'mods');
}

async function performModrinthSearch(query, mcVersion, projectType) {
  try {
    const url = `https://api.modrinth.com/v2/search`;
    const facetsList = [];
    if (projectType === 'mod') {
      facetsList.push(["categories:fabric"]);
    }
    if (mcVersion) {
      facetsList.push([`versions:${mcVersion}`]);
    }
    facetsList.push([`project_type:${projectType}`]);

    const response = await axios.get(url, {
      params: {
        query,
        facets: JSON.stringify(facetsList),
        limit: 20
      },
      headers: { 'User-Agent': 'Ciapongi-RP-Launcher' }
    });

    const mainPackModIds = projectType === 'mod' ? getMainPackModIds() : [];

    return response.data.hits.map(hit => {
      const slugClean = hit.slug ? hit.slug.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
      const titleClean = hit.title ? hit.title.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
      const idClean = hit.project_id ? hit.project_id.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

      const inMainPack = projectType === 'mod' && (
        mainPackModIds.includes(slugClean) ||
        mainPackModIds.includes(titleClean) ||
        mainPackModIds.includes(idClean)
      );

      return {
        id: hit.project_id,
        title: hit.title,
        description: hit.description,
        icon_url: hit.icon_url,
        author: hit.author,
        slug: hit.slug,
        inMainPack: !!inMainPack
      };
    });
  } catch (err) {
    console.error(`Błąd wyszukiwania w Modrinth (${projectType}):`, err);
    return [];
  }
}

ipcMain.handle('search-modrinth', async (event, { query, mcVersion, projectType }) => {
  return performModrinthSearch(query, mcVersion, projectType);
});

async function installModrinthProjectInternal(projectId, projectType, config, gameDir, installedSet = new Set()) {
  if (installedSet.has(projectId)) {
    return { success: true, message: 'Projekt przetworzony w bieżącej sesji.' };
  }
  installedSet.add(projectId);

  const targetDir = getFolderForProjectType(gameDir, projectType);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let realSlug = projectId.toLowerCase().replace(/[^a-z0-9]/g, '');
  let realTitle = realSlug;
  let projectInfo = { title: projectId, icon_url: null, slug: projectId };
  try {
    const projRes = await axios.get(`https://api.modrinth.com/v2/project/${projectId}`, {
      headers: { 'User-Agent': 'Ciapongi-RP-Launcher' }
    });
    if (projRes.data) {
      projectInfo = projRes.data;
      if (projRes.data.slug) realSlug = projRes.data.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (projRes.data.title) realTitle = projRes.data.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
  } catch (e) { }

  let targetVersion = null;
  try {
    const versionsUrl = `https://api.modrinth.com/v2/project/${projectId}/version`;
    const versionsRes = await axios.get(versionsUrl, {
      headers: { 'User-Agent': 'Ciapongi-RP-Launcher' }
    });

    const targetLoader = config.loader || 'fabric';
    let compatibleVersions = versionsRes.data;

    if (projectType === 'mod') {
      compatibleVersions = compatibleVersions.filter(v =>
        v.game_versions.includes(config.minecraftVersion) &&
        v.loaders.includes(targetLoader)
      );
    } else {
      const versionFiltered = compatibleVersions.filter(v =>
        v.game_versions.includes(config.minecraftVersion)
      );
      if (versionFiltered.length > 0) {
        compatibleVersions = versionFiltered;
      }
    }

    if (compatibleVersions.length === 0) {
      if (projectType === 'mod') {
        compatibleVersions = versionsRes.data.filter(v => v.loaders && v.loaders.includes(targetLoader));
      }
      if (compatibleVersions.length === 0) {
        compatibleVersions = versionsRes.data;
      }
    }

    if (compatibleVersions.length > 0) {
      targetVersion = compatibleVersions[0];
    }
  } catch (e) { }

  const existingFiles = fs.readdirSync(targetDir);
  const matchFile = existingFiles.find(f => {
    const cleanName = f.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (realSlug.length > 2 && cleanName.includes(realSlug)) || (realTitle.length > 3 && cleanName.includes(realTitle));
  });

  let fileAlreadyPresent = false;
  if (matchFile) {
    const fullPath = path.join(targetDir, matchFile);
    if (matchFile.endsWith('.disabled')) {
      const enabledPath = fullPath.replace(/\.disabled$/, '');
      fs.renameSync(fullPath, enabledPath);
      mainWindow.webContents.send('status-message', `Włączono istniejący plik: ${path.basename(enabledPath)}`);
    } else if (matchFile.endsWith('.jar') || matchFile.endsWith('.zip')) {
      mainWindow.webContents.send('status-message', `Mod jest już zainstalowany: ${matchFile}`);
    }
    fileAlreadyPresent = true;
  }

  if (!fileAlreadyPresent) {
    if (!targetVersion) {
      throw new Error(`Nie odnaleziono kompatybilnej wersji dla ${projectInfo.title || projectId}`);
    }

    const projectFile = targetVersion.files.find(f => f.primary) || targetVersion.files[0];
    if (!projectFile) {
      throw new Error("Nie znaleziono pliku projektu.");
    }

    mainWindow.webContents.send('status-message', `Pobieranie: ${projectFile.filename}...`);
    const tempPath = path.join(gameDir, 'temp_' + projectFile.filename);
    await downloadFile(projectFile.url, tempPath, null, { 'User-Agent': 'Ciapongi-RP-Launcher' });

    if (projectType === 'mod') {
      let downloadedInternalModId = null;
      try {
        const zip = new AdmZip(tempPath);
        const zipEntry = zip.getEntry('fabric.mod.json');
        if (zipEntry) {
          const modJson = JSON.parse(zipEntry.getData().toString('utf8'));
          downloadedInternalModId = modJson.id;
        }
      } catch (e) { }

      if (downloadedInternalModId) {
        const mainPackModIds = getMainPackModIds();
        if (mainPackModIds.includes(downloadedInternalModId.toLowerCase())) {
          try { fs.rmSync(tempPath, { force: true }); } catch (e) { }
          return { success: true, message: `Mod "${projectFile.filename}" jest już częścią paczki głównej.` };
        }
      }
    }

    const destPath = path.join(targetDir, projectFile.filename);
    fs.renameSync(tempPath, destPath);

    const userManifestPath = path.join(gameDir, 'user-manifest.json');
    let userProjects = [];
    if (fs.existsSync(userManifestPath)) {
      try {
        userProjects = JSON.parse(fs.readFileSync(userManifestPath, 'utf8'));
      } catch (e) { }
    }
    userProjects = userProjects.filter(p => p.id !== projectId);
    userProjects.push({
      id: projectId,
      filename: projectFile.filename,
      title: projectInfo.title || projectId,
      icon_url: projectInfo.icon_url,
      enabled: true,
      type: projectType
    });
    fs.writeFileSync(userManifestPath, JSON.stringify(userProjects, null, 2), 'utf8');
  }

  if (targetVersion && targetVersion.dependencies && Array.isArray(targetVersion.dependencies)) {
    for (const dep of targetVersion.dependencies) {
      if (dep.dependency_type === 'required') {
        let depProjectId = dep.project_id;

        if (!depProjectId && dep.version_id) {
          try {
            const verRes = await axios.get(`https://api.modrinth.com/v2/version/${dep.version_id}`, {
              headers: { 'User-Agent': 'Ciapongi-RP-Launcher' }
            });
            if (verRes.data && verRes.data.project_id) {
              depProjectId = verRes.data.project_id;
            }
          } catch (e) {
            console.error(`Nie udało się rozwiązać project_id dla zależności wersji ${dep.version_id}`);
          }
        }

        if (depProjectId) {
          mainWindow.webContents.send('status-message', `Sprawdzanie/Pobieranie wymaganej zależności (${depProjectId}) dla ${projectInfo.title || projectId}...`);
          try {
            await installModrinthProjectInternal(depProjectId, projectType, config, gameDir, installedSet);
          } catch (depErr) {
            console.error(`Błąd podczas pobierania zależności ${depProjectId}:`, depErr.message);
          }
        }
      }
    }
  }

  return { success: true, title: projectInfo.title || projectId };
}

ipcMain.handle('install-modrinth-project', async (event, { projectId, projectType }) => {
  const config = readConfig();
  const gameDir = config.gameDir;

  try {
    const res = await installModrinthProjectInternal(projectId, projectType, config, gameDir);
    mainWindow.webContents.send('status-message', `Zainstalowano pomyślnie: ${res.title || projectId}!`);
    return { success: true };
  } catch (err) {
    console.error(`Błąd instalowania projektu (${projectType}) z Modrinth:`, err);
    mainWindow.webContents.send('status-message', `Błąd instalacji: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-user-projects', async (event, { projectType }) => {
  const config = readConfig();
  const gameDir = config.gameDir;

  if (projectType === 'pack-mod' || projectType === 'pack-resourcepack') {
    const manifestPath = path.join(gameDir, 'pack-manifest.json');
    const isMod = projectType === 'pack-mod';
    const targetFolder = isMod ? 'mods' : 'resourcepacks';
    const targetDir = path.join(gameDir, targetFolder);
    const prefix = isMod ? 'mods/' : 'resourcepacks/';
    const ext = isMod ? '.jar' : '.zip';
    const packItems = [];

    if (fs.existsSync(manifestPath)) {
      try {
        const manifestFiles = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const mainPackFiles = manifestFiles.filter(f => f.toLowerCase().startsWith(prefix) && (f.toLowerCase().endsWith(ext) || f.toLowerCase().endsWith('.disabled')));

        for (const fileRel of mainPackFiles) {
          const baseFilename = path.basename(fileRel).replace(/\.disabled$/i, '');
          const standardPath = path.join(targetDir, baseFilename);
          const disabledPath = path.join(targetDir, baseFilename + '.disabled');

          const existsStandard = fs.existsSync(standardPath);
          const existsDisabled = fs.existsSync(disabledPath);

          if (existsStandard || existsDisabled) {
            const actualPath = existsStandard ? standardPath : disabledPath;
            let title = baseFilename.replace(new RegExp(`\\${ext}$`, 'i'), '');

            if (isMod) {
              try {
                const zip = new AdmZip(actualPath);
                const zipEntry = zip.getEntry('fabric.mod.json');
                if (zipEntry) {
                  const modJson = JSON.parse(zipEntry.getData().toString('utf8'));
                  if (modJson.name) title = modJson.name;
                }
              } catch (e) { }
            }

            packItems.push({
              id: `pack-${baseFilename}`,
              filename: baseFilename,
              title: title,
              icon_url: null,
              enabled: existsStandard,
              type: projectType,
              isPackMod: true
            });
          }
        }
      } catch (err) {
        console.error("Błąd odczytu zasobów z paczki głównej:", err);
      }
    }
    return packItems;
  }

  const userManifestPath = path.join(gameDir, 'user-manifest.json');
  const targetDir = getFolderForProjectType(gameDir, projectType);

  let userProjects = [];
  if (fs.existsSync(userManifestPath)) {
    try {
      userProjects = JSON.parse(fs.readFileSync(userManifestPath, 'utf8'));
    } catch (e) { }
  }

  const packManifestPath = path.join(gameDir, 'pack-manifest.json');
  const packManifestFiles = new Set();
  if (fs.existsSync(packManifestPath)) {
    try {
      const manifestArr = JSON.parse(fs.readFileSync(packManifestPath, 'utf8'));
      const prefix = (projectType === 'resourcepack') ? 'resourcepacks/' :
        (projectType === 'shader') ? 'shaderpacks/' : 'mods/';
      for (const mFile of manifestArr) {
        if (mFile.toLowerCase().startsWith(prefix)) {
          const baseName = path.basename(mFile).replace(/\.disabled$/i, '').toLowerCase();
          packManifestFiles.add(baseName);
        }
      }
    } catch (e) { }
  }

  try {
    const filteredProjects = [];
    let manifestChanged = false;

    const typedProjects = userProjects.filter(p => {
      const itemType = p.type || 'mod';
      return itemType === projectType;
    });

    const otherProjects = userProjects.filter(p => {
      const itemType = p.type || 'mod';
      return itemType !== projectType;
    });

    for (const project of typedProjects) {
      const standardPath = path.join(targetDir, project.filename);
      const disabledPath = path.join(targetDir, project.filename + '.disabled');
      const fileExists = fs.existsSync(standardPath) || fs.existsSync(disabledPath);

      if (!fileExists) {
        manifestChanged = true;
        continue;
      }

      if (packManifestFiles.has(project.filename.toLowerCase())) {
        continue;
      }

      filteredProjects.push({
        ...project,
        type: projectType
      });
    }

    if (fs.existsSync(targetDir)) {
      const extPattern = projectType === 'mod' ? /\.jar$/i : /\.zip$/i;
      const diskFiles = fs.readdirSync(targetDir);

      for (const file of diskFiles) {
        const isStandard = extPattern.test(file);
        const isDisabled = file.endsWith('.disabled') && extPattern.test(file.slice(0, -9));

        if (isStandard || isDisabled) {
          const baseFilename = isStandard ? file : file.slice(0, -9);

          if (packManifestFiles.has(baseFilename.toLowerCase())) {
            continue;
          }

          const inManifest = filteredProjects.some(p => p.filename === baseFilename);

          if (!inManifest) {
            filteredProjects.push({
              id: `local-${baseFilename}`,
              filename: baseFilename,
              title: baseFilename.replace(extPattern, ''),
              icon_url: null,
              enabled: isStandard,
              type: projectType,
              isLocal: true
            });
            manifestChanged = true;
          }
        }
      }
    }

    if (manifestChanged) {
      fs.writeFileSync(userManifestPath, JSON.stringify([...otherProjects, ...filteredProjects.filter(p => !p.isLocal)], null, 2), 'utf8');
    }

    return filteredProjects;
  } catch (err) {
    console.error(`Błąd listowania projektów (${projectType}):`, err);
    return [];
  }
});

ipcMain.handle('toggle-project', async (event, { filename, enabled, projectType }) => {
  const config = readConfig();
  const gameDir = config.gameDir;
  const targetDir = getFolderForProjectType(gameDir, projectType);

  if (!fs.existsSync(targetDir)) {
    return { success: false, error: 'Katalog nie istnieje.' };
  }

  const cleanTarget = filename.toLowerCase();

  try {
    const diskFiles = fs.readdirSync(targetDir);

    const exactStandard = diskFiles.find(f => !f.endsWith('.disabled') && f.toLowerCase() === cleanTarget);
    const exactDisabled = diskFiles.find(f => f.endsWith('.disabled') && f.toLowerCase() === (cleanTarget + '.disabled'));
    const fuzzyStandard = diskFiles.find(f => !f.endsWith('.disabled') && (f.toLowerCase().includes(cleanTarget.replace(/\.(jar|zip)$/i, ''))));
    const fuzzyDisabled = diskFiles.find(f => f.endsWith('.disabled') && (f.toLowerCase().includes(cleanTarget.replace(/\.(jar|zip)$/i, ''))));

    const standardFile = exactStandard || fuzzyStandard;
    const disabledFile = exactDisabled || fuzzyDisabled;

    if (enabled) {
      if (disabledFile) {
        const srcPath = path.join(targetDir, disabledFile);
        const destPath = path.join(targetDir, disabledFile.replace(/\.disabled$/i, ''));
        fs.renameSync(srcPath, destPath);
      }
    } else {
      if (standardFile) {
        const srcPath = path.join(targetDir, standardFile);
        const destPath = path.join(targetDir, standardFile + '.disabled');
        fs.renameSync(srcPath, destPath);
      }
    }

    const userManifestPath = path.join(gameDir, 'user-manifest.json');
    if (fs.existsSync(userManifestPath)) {
      try {
        const userProjects = JSON.parse(fs.readFileSync(userManifestPath, 'utf8'));
        const updated = userProjects.map(p => {
          if (p.filename.toLowerCase() === cleanTarget || p.filename.toLowerCase().includes(cleanTarget.replace(/\.(jar|zip)$/i, ''))) {
            return { ...p, enabled };
          }
          return p;
        });
        fs.writeFileSync(userManifestPath, JSON.stringify(updated, null, 2), 'utf8');
      } catch (e) { }
    }
    return { success: true };
  } catch (err) {
    console.error(`Błąd przełączania projektu (${projectType}):`, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-project', async (event, { filename, projectType }) => {
  const config = readConfig();
  const gameDir = config.gameDir;
  const targetDir = getFolderForProjectType(gameDir, projectType);

  if (!fs.existsSync(targetDir)) {
    return { success: true };
  }

  const cleanTarget = filename.toLowerCase();

  try {
    const diskFiles = fs.readdirSync(targetDir);
    for (const f of diskFiles) {
      const fClean = f.toLowerCase();
      if (fClean === cleanTarget || fClean === (cleanTarget + '.disabled') || fClean.includes(cleanTarget.replace(/\.(jar|zip)$/i, ''))) {
        try {
          fs.rmSync(path.join(targetDir, f), { force: true });
        } catch (e) { }
      }
    }

    const userManifestPath = path.join(gameDir, 'user-manifest.json');
    if (fs.existsSync(userManifestPath)) {
      try {
        const userProjects = JSON.parse(fs.readFileSync(userManifestPath, 'utf8'));
        const filtered = userProjects.filter(p => !(p.filename.toLowerCase() === cleanTarget || p.filename.toLowerCase().includes(cleanTarget.replace(/\.(jar|zip)$/i, ''))));
        fs.writeFileSync(userManifestPath, JSON.stringify(filtered, null, 2), 'utf8');
      } catch (e) { }
    }
    return { success: true };
  } catch (err) {
    console.error(`Błąd usuwania projektu (${projectType}):`, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('add-local-project', async (event, { filePath, projectType }) => {
  const config = readConfig();
  const gameDir = config.gameDir;
  const targetDir = getFolderForProjectType(gameDir, projectType);

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error("Plik źródłowy nie istnieje.");
    }

    const filename = path.basename(filePath);
    const isZip = filename.toLowerCase().endsWith('.zip');
    const isJar = filename.toLowerCase().endsWith('.jar');

    if (projectType === 'mod' && !isJar) {
      throw new Error("Modyfikacja musi mieć rozszerzenie .jar!");
    }
    if (projectType !== 'mod' && !isZip) {
      throw new Error("Shadery i Paczki zasobów muszą mieć rozszerzenie .zip!");
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const destPath = path.join(targetDir, filename);

    const tempPath = path.join(gameDir, 'temp_' + filename);
    fs.copyFileSync(filePath, tempPath);

    let internalId = null;
    let displayName = filename.replace(/\.(jar|zip)$/i, '');

    if (projectType === 'mod') {
      try {
        const zip = new AdmZip(tempPath);
        const zipEntry = zip.getEntry('fabric.mod.json');
        if (zipEntry) {
          const modJson = JSON.parse(zipEntry.getData().toString('utf8'));
          internalId = modJson.id;
          displayName = modJson.name || displayName;
        }
      } catch (e) {
        console.error("Błąd parsowania lokalnego moda:", e);
      }

      if (internalId) {
        const mainPackModIds = getMainPackModIds();
        if (mainPackModIds.includes(internalId.toLowerCase())) {
          try { fs.rmSync(tempPath, { force: true }); } catch (e) { }
          throw new Error(`Mod "${displayName}" jest już częścią paczki głównej!`);
        }
      }
    }

    if (fs.existsSync(destPath) || fs.existsSync(destPath + '.disabled')) {
      try { fs.rmSync(tempPath, { force: true }); } catch (e) { }
      throw new Error(`Plik o nazwie "${filename}" jest już zainstalowany.`);
    }

    fs.renameSync(tempPath, destPath);

    const userManifestPath = path.join(gameDir, 'user-manifest.json');
    let userProjects = [];
    if (fs.existsSync(userManifestPath)) {
      try {
        userProjects = JSON.parse(fs.readFileSync(userManifestPath, 'utf8'));
      } catch (e) { }
    }

    const id = `local-${internalId || displayName.replace(/\s+/g, '-')}`;
    userProjects = userProjects.filter(p => !(p.id === id && (p.type || 'mod') === projectType));

    userProjects.push({
      id,
      filename,
      title: displayName,
      icon_url: null,
      enabled: true,
      type: projectType
    });

    fs.writeFileSync(userManifestPath, JSON.stringify(userProjects, null, 2), 'utf8');

    return { success: true, title: displayName };

  } catch (err) {
    console.error(`Błąd dodawania lokalnego projektu (${projectType}):`, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('search-mods', async (event, { query, mcVersion }) => {
  return performModrinthSearch(query, mcVersion, 'mod');
});

ipcMain.handle('install-mod', async (event, { modId }) => {
  return await ipcMain.listeners('install-modrinth-project')[0](event, { projectId: modId, projectType: 'mod' });
});

ipcMain.handle('get-user-mods', async (event) => {
  return await ipcMain.listeners('get-user-projects')[0](event, { projectType: 'mod' });
});

ipcMain.handle('toggle-mod', async (event, { filename, enabled }) => {
  return await ipcMain.listeners('toggle-project')[0](event, { filename, enabled, projectType: 'mod' });
});

ipcMain.handle('delete-mod', async (event, { filename }) => {
  return await ipcMain.listeners('delete-project')[0](event, { filename, projectType: 'mod' });
});

ipcMain.handle('add-local-mod', async (event, { filePath }) => {
  return await ipcMain.listeners('add-local-project')[0](event, { filePath, projectType: 'mod' });
});

function cleanDuplicateMods(modsDir) {
  if (!fs.existsSync(modsDir)) return;
  try {
    const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
    const modIdMap = {};

    for (const file of files) {
      const filePath = path.join(modsDir, file);
      try {
        const zip = new AdmZip(filePath);
        const zipEntry = zip.getEntry('fabric.mod.json');
        if (zipEntry) {
          const modJson = JSON.parse(zipEntry.getData().toString('utf8'));
          const modId = modJson.id;
          if (modId) {
            if (!modIdMap[modId]) modIdMap[modId] = [];
            modIdMap[modId].push({
              file,
              path: filePath,
              mtime: fs.statSync(filePath).mtimeMs
            });
          }
        }
      } catch (e) { }
    }

    const disabledList = [];
    for (const modId in modIdMap) {
      const list = modIdMap[modId];
      if (list.length > 1) {
        list.sort((a, b) => b.mtime - a.mtime);
        for (let i = 1; i < list.length; i++) {
          const duplicate = list[i];
          const disabledPath = duplicate.path + '.disabled';
          if (fs.existsSync(duplicate.path)) {
            fs.renameSync(duplicate.path, disabledPath);
            disabledList.push(duplicate.file);
          }
        }
      }
    }
    if (disabledList.length > 0) {
      logToFile(`[SYSTEM] Wykryto i wyłączono duplikaty modów: ${disabledList.join(', ')}`);
    }
  } catch (err) {
    console.error("Błąd podczas czyszczenia duplikatów modów:", err);
  }
}

ipcMain.handle('launch-game', async () => {
  const config = readConfig();
  const gameDir = config.gameDir;

  if (!fs.existsSync(gameDir)) {
    fs.mkdirSync(gameDir, { recursive: true });
  }

  cleanDuplicateMods(path.join(gameDir, 'mods'));

  try {
    fs.writeFileSync(logPath, `--- LOG URUCHOMIENIA GRY - ${new Date().toLocaleString()} ---\n`, 'utf8');
  } catch (e) {
    console.error(e);
  }

  try {
    let requiredJavaVer = 17;
    if (config.javaVersion && config.javaVersion !== 'auto') {
      requiredJavaVer = parseInt(config.javaVersion, 10);
    } else {
      const mcVer = config.minecraftVersion;
      if (mcVer.startsWith('1.20.5') || mcVer.startsWith('1.20.6') || mcVer.startsWith('1.21') || mcVer.startsWith('1.22')) {
        requiredJavaVer = 21;
      } else if (mcVer.startsWith('1.16') || mcVer.startsWith('1.15') || mcVer.startsWith('1.12')) {
        requiredJavaVer = 8;
      } else {
        requiredJavaVer = 17;
      }
    }

    let finalJavaPath = config.javaPath;
    if (!finalJavaPath) {
      const javaDir = path.join(gameDir, `java-runtime-${requiredJavaVer}`);
      const javaExec = findJavaExecutable(javaDir);

      if (javaExec) {
        finalJavaPath = javaExec;
      } else {
        mainWindow.webContents.send('status-message', `Przygotowywanie środowiska Java ${requiredJavaVer}...`);
        mainWindow.webContents.send('launch-progress', { status: 'java_download', progress: 0 });

        const isWin = process.platform === 'win32';
        const javaTempFile = path.join(gameDir, isWin ? 'java.zip' : 'java.tar.gz');
        const arch = process.arch === 'ia32' ? 'x32' : (process.arch === 'arm64' ? 'aarch64' : 'x64');
        const javaUrl = `https://api.adoptium.net/v3/binary/latest/${requiredJavaVer}/ga/${isWin ? 'windows' : 'linux'}/${arch}/jdk/hotspot/normal/eclipse`;

        await downloadFile(javaUrl, javaTempFile, (progressData) => {
          mainWindow.webContents.send('launch-progress', {
            status: 'java_download',
            progress: progressData.progress,
            transferred: progressData.transferred,
            total: progressData.total,
            speed: progressData.speed
          });
        });

        mainWindow.webContents.send('status-message', 'Instalowanie wymaganej wersji Javy...');
        mainWindow.webContents.send('launch-progress', { status: 'java_extract', progress: 50 });

        if (fs.existsSync(javaDir)) {
          fs.rmSync(javaDir, { recursive: true, force: true });
        }
        fs.mkdirSync(javaDir, { recursive: true });

        if (isWin) {
          const zip = new AdmZip(javaTempFile);
          zip.extractAllTo(javaDir, true);
        } else {
          const { execSync } = require('child_process');
          execSync(`tar -xzf "${javaTempFile}" -C "${javaDir}"`);
        }

        fs.rmSync(javaTempFile);

        finalJavaPath = findJavaExecutable(javaDir);
        if (!finalJavaPath) {
          throw new Error(`Pobrane środowisko Java ${requiredJavaVer} jest nieprawidłowe. Brak pliku wykonywalnego java.`);
        }

        if (!isWin) {
          try {
            fs.chmodSync(finalJavaPath, '755');
          } catch (chmodErr) {
            console.error("Błąd chmod dla Java:", chmodErr);
          }
        }
      }
    }

    mainWindow.webContents.send('status-message', `Java: ${finalJavaPath}`);

    mainWindow.webContents.send('status-message', 'Uruchamianie silnika Fabric...');

    const fabricVersionId = `fabric-loader-${config.loaderVersion}-${config.minecraftVersion}`;
    const versionDir = path.join(gameDir, 'versions', fabricVersionId);
    const versionJsonPath = path.join(versionDir, `${fabricVersionId}.json`);

    if (!fs.existsSync(versionJsonPath)) {
      fs.mkdirSync(versionDir, { recursive: true });
      const fabricMetaUrl = `https://meta.fabricmc.net/v2/versions/loader/${config.minecraftVersion}/${config.loaderVersion}/profile/json`;

      try {
        const response = await axios.get(fabricMetaUrl, { timeout: 10000 });
        fs.writeFileSync(versionJsonPath, JSON.stringify(response.data, null, 2), 'utf8');
      } catch (err) {
        throw new Error(`Nie udało się pobrać konfiguracji profilu Fabric z meta.fabricmc.net (${err.message})`);
      }
    }

    mainWindow.webContents.send('status-message', 'Uruchamianie gry Minecraft (pobieranie plików i bibliotek)...');

    const launcher = new Client();

    let authObject = {
      access_token: 'token',
      client_token: 'client',
      uuid: 'uuid',
      name: config.nickname || 'Gracz',
      user_properties: '{}',
      selected_profile: {
        id: 'uuid',
        name: config.nickname || 'Gracz'
      }
    };

    if (config.loginType === 'microsoft' && config.microsoftAuth) {
      if (config.microsoftAuth.profile) {
        authObject = config.microsoftAuth.profile;
      } else {
        authObject = {
          access_token: config.microsoftAuth.access_token,
          client_token: 'client',
          uuid: config.microsoftAuth.uuid,
          name: config.microsoftAuth.name,
          user_properties: '{}',
          selected_profile: {
            id: config.microsoftAuth.uuid,
            name: config.microsoftAuth.name
          }
        };
      }
    }

    const launchOpts = {
      authorization: authObject,
      root: gameDir,
      version: {
        number: config.minecraftVersion,
        type: 'release',
        custom: fabricVersionId
      },
      memory: {
        max: `${config.ram}M`,
        min: `${config.ram}M`
      },
      javaPath: finalJavaPath
    };

    let profileToUse = config.jvmProfile || 'auto';
    if (profileToUse === 'auto') {
      const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
      if (totalMb <= 4500) {
        profileToUse = 'ultra_potato';
      } else if (totalMb <= 6500) {
        profileToUse = 'potato';
      } else {
        profileToUse = 'optimized_g1gc';
      }
      logToFile(`[SYSTEM] Profil JVM ustawiony na 'auto'. Automatycznie dobrano profil: ${profileToUse} (Dostępna pamięć: ${totalMb} MB)`);
    } else {
      logToFile(`[SYSTEM] Używanie wybranego profilu JVM: ${profileToUse}`);
    }

    if (profileToUse === 'extreme_zgc' && requiredJavaVer === 8) {
      logToFile("[SYSTEM] Ostrzeżenie: Wykryto Java 8 przy wybranym profilu ZGC. Zmiana profilu na G1GC dla kompatybilności.");
      profileToUse = 'optimized_g1gc';
    }

    let customArgs = [];
    if (profileToUse === 'ultra_potato') {
      customArgs = [
        "-XX:+UseG1GC",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:G1NewSizePercent=10",
        "-XX:G1ReservePercent=10",
        "-XX:MaxGCPauseMillis=100",
        "-XX:G1HeapRegionSize=8M",
        "-XX:+DisableExplicitGC",
        "-XX:-AlwaysPreTouch",
        "-XX:+UseStringDeduplication",
        "-XX:MinMetaspaceFreeRatio=5",
        "-XX:MaxMetaspaceFreeRatio=10",
        "-XX:MaxDirectMemorySize=512m",
        "-Dsun.rmi.dgc.server.gcInterval=2147483646",
        "-Djava.awt.headless=false",
        "-Dfml.ignorePatchDiscrepancies=true",
        "-XX:ConcGCThreads=1",
        "-XX:ParallelGCThreads=2"
      ];
    } else if (profileToUse === 'potato') {
      customArgs = [
        "-XX:+UseG1GC",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:G1NewSizePercent=20",
        "-XX:G1ReservePercent=20",
        "-XX:MaxGCPauseMillis=50",
        "-XX:G1HeapRegionSize=16M",
        "-XX:+DisableExplicitGC",
        "-XX:+AlwaysPreTouch",
        "-XX:+UseStringDeduplication",
        "-XX:MinMetaspaceFreeRatio=5",
        "-XX:MaxMetaspaceFreeRatio=15",
        "-XX:MaxDirectMemorySize=1G",
        "-Dsun.rmi.dgc.server.gcInterval=2147483646"
      ];
    } else if (profileToUse === 'optimized_g1gc') {
      customArgs = [
        "-XX:+UseG1GC",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:MaxGCPauseMillis=20",
        "-XX:G1NewSizePercent=30",
        "-XX:G1ReservePercent=20",
        "-XX:InitiatingHeapOccupancyPercent=15",
        "-XX:G1MixedGCLiveThresholdPercent=90",
        "-XX:G1HeapRegionSize=32M",
        "-XX:MinMetaspaceFreeRatio=5",
        "-XX:+MaxMetaspaceFreeRatio=10",
        "-XX:+ParallelRefProcEnabled",
        "-XX:+UseStringDeduplication",
        "-XX:+AlwaysPreTouch",
        "-XX:MaxDirectMemorySize=2G"
      ];
    } else if (profileToUse === 'extreme_zgc') {
      customArgs = [
        "-XX:+UseZGC",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:+AlwaysPreTouch",
        "-XX:+DisableExplicitGC",
        "-XX:+ParallelRefProcEnabled",
        "-XX:SoftMaxHeapSize=8192m",
        "-XX:MaxDirectMemorySize=2G"
      ];
      if (requiredJavaVer === 21) {
        customArgs.push("-XX:+ZGenerational");
      }
    }

    if (customArgs.length > 0) {
      launchOpts.customArgs = customArgs;
      logToFile(`[SYSTEM] Dodano argumenty JVM: ${customArgs.join(' ')}`);
    }

    launcher.on('debug', (e) => {
      const formatted = `[MCLC DEBUG] ${e}`;
      mainWindow.webContents.send('game-log', formatted);
      logToFile(formatted);
    });
    launcher.on('data', (e) => {
      mainWindow.webContents.send('game-log', e);
      logToFile(e.trimEnd());
    });
    launcher.on('progress', (e) => {
      const percent = Math.round((e.task / e.total) * 100);
      mainWindow.webContents.send('launch-progress', {
        status: 'game_download',
        progress: percent,
        detail: `${e.type}: ${e.task}/${e.total}`
      });
    });
    launcher.on('download-status', (e) => {
      mainWindow.webContents.send('status-message', `Pobieranie plików gry... (${e.current}/${e.total})`);
    });

    launcher.on('close', (code) => {
      console.log(`Gra wyłączona z kodem: ${code}`);
      minecraftProcess = null;
      mainWindow.webContents.send('launch-progress', { status: 'idle', progress: 0 });
      mainWindow.webContents.send('status-message', `Gra została wyłączona (kod: ${code})`);
      logToFile(`\n[SYSTEM] Gra została zamknięta z kodem wyjścia: ${code}`);
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    minecraftProcess = await launcher.launch(launchOpts);

    mainWindow.webContents.send('status-message', 'Gra pomyślnie wystartowała! Życzymy miłej zabawy.');
    mainWindow.webContents.send('launch-progress', { status: 'running', progress: 100 });
    logToFile("[SYSTEM] Pomyślnie przekazano kontrolę do procesu Minecraft.");

    setTimeout(() => {
      if (mainWindow) {
        if (config.potatoMode) {
          mainWindow.hide();
        } else {
          mainWindow.minimize();
        }
      }
    }, 5000);

    return { success: true };

  } catch (err) {
    console.error("Błąd podczas uruchamiania gry:", err);
    mainWindow.webContents.send('status-message', `Błąd uruchamiania: ${err.message}`);
    mainWindow.webContents.send('launch-progress', { status: 'error', error: err.message });
    logToFile(`[ERROR] ${err.stack || err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('kill-game', async () => {
  if (minecraftProcess) {
    try {
      minecraftProcess.kill('SIGKILL');
    } catch (e) {
      console.error("Błąd ubijania gry:", e);
    }
    minecraftProcess = null;
    return true;
  }
  return false;
});
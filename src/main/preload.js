const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window Controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  platform: process.platform,

  // Config / Settings
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getSystemRam: () => ipcRenderer.invoke('get-system-ram'),
  getSystemSpecs: () => ipcRenderer.invoke('get-system-specs'),
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  openFolder: (subfolder) => ipcRenderer.invoke('open-folder', subfolder),
  loginMicrosoft: () => ipcRenderer.invoke('login-microsoft'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  // Konta
  addServerToMinecraft: () => ipcRenderer.invoke('add-server-to-minecraft'),
  addAccount: (data) => ipcRenderer.invoke('add-account', data),
  switchAccount: (data) => ipcRenderer.invoke('switch-account', data),
  removeAccount: (data) => ipcRenderer.invoke('remove-account', data),
  
  // Modpack GitHub Sync
  syncPack: (force) => ipcRenderer.invoke('sync-pack', force),
  getLatestReleaseNotes: () => ipcRenderer.invoke('get-latest-release-notes'),
  getPackVersions: () => ipcRenderer.invoke('get-pack-versions'),
  
  // Screenshots
  getScreenshots: () => ipcRenderer.invoke('get-screenshots'),
  deleteScreenshot: (filename) => ipcRenderer.invoke('delete-screenshot', filename),
  
  // Modrinth API (Generalized)
  searchModrinth: (query, mcVersion, projectType) => ipcRenderer.invoke('search-modrinth', { query, mcVersion, projectType }),
  installModrinthProject: (projectId, projectType) => ipcRenderer.invoke('install-modrinth-project', { projectId, projectType }),
  
  // User custom assets (Generalized)
  getUserProjects: (projectType) => ipcRenderer.invoke('get-user-projects', { projectType }),
  toggleProject: (filename, enabled, projectType) => ipcRenderer.invoke('toggle-project', { filename, enabled, projectType }),
  deleteProject: (filename, projectType) => ipcRenderer.invoke('delete-project', { filename, projectType }),
  addLocalProject: (filePath, projectType) => ipcRenderer.invoke('add-local-project', { filePath, projectType }),
  
  // Modrinth API (Legacy)
  searchMods: (query, mcVersion) => ipcRenderer.invoke('search-mods', { query, mcVersion }),
  installMod: (modId, versionId) => ipcRenderer.invoke('install-mod', { modId, versionId }),
  
  // User custom mods (Legacy)
  getUserMods: () => ipcRenderer.invoke('get-user-mods'),
  toggleMod: (filename, enabled) => ipcRenderer.invoke('toggle-mod', { filename, enabled }),
  deleteMod: (filename) => ipcRenderer.invoke('delete-mod', { filename }),
  addLocalMod: (filePath) => ipcRenderer.invoke('add-local-mod', { filePath }),
  
  // Launch Minecraft
  launchGame: () => ipcRenderer.invoke('launch-game'),
  killGame: () => ipcRenderer.invoke('kill-game'),
  
  // Launcher Updater
  checkForLauncherUpdates: () => ipcRenderer.invoke('check-for-launcher-updates'),
  installLauncherUpdate: () => ipcRenderer.invoke('install-launcher-update'),
  getLauncherReleaseNotes: () => ipcRenderer.invoke('get-launcher-release-notes'),
  getLauncherVersion: () => ipcRenderer.invoke('get-launcher-version'),
  onLauncherUpdateEvent: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('launcher-update-event', listener);
    return () => ipcRenderer.removeListener('launcher-update-event', listener);
  },

  // Event Listeners for Progress & Logs
  onPackSyncProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('pack-sync-progress', listener);
    return () => ipcRenderer.removeListener('pack-sync-progress', listener);
  },
  onLaunchProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('launch-progress', listener);
    return () => ipcRenderer.removeListener('launch-progress', listener);
  },
  onGameLog: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('game-log', listener);
    return () => ipcRenderer.removeListener('game-log', listener);
  },
  onStatusMessage: (callback) => {
    const listener = (event, msg) => callback(msg);
    ipcRenderer.on('status-message', listener);
    return () => ipcRenderer.removeListener('status-message', listener);
  }
});

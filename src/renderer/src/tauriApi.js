import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';

function detectPlatform() {
  const nav = (navigator.platform || navigator.userAgent || '').toLowerCase();
  if (nav.includes('win')) return 'win32';
  if (nav.includes('mac') || nav.includes('darwin')) return 'darwin';
  return 'linux';
}

function safeListen(eventName, callback) {
  let cancelled = false;
  let unlistenFn = null;

  listen(eventName, (event) => {
    if (!cancelled) {
      callback(event.payload);
    }
  })
    .then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    })
    .catch((err) => {
      console.error(`[Tauri] Błąd subskrypcji zdarzenia ${eventName}:`, err);
    });

  return () => {
    cancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

function safeOnDragDrop(callback) {
  let cancelled = false;
  let unlistenFn = null;

  try {
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!cancelled) {
          callback(event.payload);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlistenFn = fn;
        }
      })
      .catch((err) => {
        console.error('[Tauri] Błąd subskrypcji Drag&Drop:', err);
      });
  } catch (err) {
    console.error('[Tauri] Drag&Drop niedostępne:', err);
  }

  return () => {
    cancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

const tauriApi = {
  // Window Controls
  minimize: () => invoke('window_minimize'),
  maximize: () => invoke('window_maximize'),
  close: () => invoke('window_close'),
  platform: detectPlatform(),

  // Config / Settings
  getConfig: () => invoke('get_config'),
  saveConfig: (config) => invoke('save_config', { config }),
  getSystemRam: () => invoke('get_system_ram'),
  getSystemSpecs: () => invoke('get_system_specs'),
  getServerStatus: () => invoke('get_server_status'),
  openFolder: (subfolder) => invoke('open_folder', { subfolder: subfolder || '' }),
  loginMicrosoft: () => invoke('login_microsoft'),
  selectDirectory: () => invoke('select_directory'),
  openLogs: () => invoke('open_logs'),

  // Konta
  addServerToMinecraft: () => invoke('add_server_to_minecraft'),
  addAccount: (data) => invoke('add_account', { data }),
  switchAccount: (data) => invoke('switch_account', { index: data.index }),
  removeAccount: (data) => invoke('remove_account', { index: data.index }),

  // Modpack Sync
  syncPack: (force = false) => invoke('sync_pack', { force: !!force }),
  getLatestReleaseNotes: () => invoke('get_latest_release_notes'),
  getPackVersions: () => invoke('get_pack_versions'),

  // Screenshots
  getScreenshots: async () => {
    const items = await invoke('get_screenshots');
    return (items || []).map((item) => ({
      ...item,
      url: item.url && item.url.startsWith('asset')
        ? item.url
        : convertFileSrc(item.path)
    }));
  },
  deleteScreenshot: (filename) => invoke('delete_screenshot', { filename }),

  // Modrinth API (Generalized)
  searchModrinth: (query, mcVersion, projectType) =>
    invoke('search_modrinth', {
      query: query || '',
      mcVersion: mcVersion || '1.20.1',
      projectType: projectType || 'mod'
    }),
  installModrinthProject: (projectId, projectType) =>
    invoke('install_modrinth_project', {
      projectId,
      projectType: projectType || 'mod'
    }),

  // User custom assets (Generalized)
  getUserProjects: (projectType) =>
    invoke('get_user_projects', { projectType: projectType || 'mod' }),
  toggleProject: (filename, enabled, projectType) =>
    invoke('toggle_project', { filename, enabled: !!enabled, projectType: projectType || 'mod' }),
  deleteProject: (filename, projectType) =>
    invoke('delete_project', { filename, projectType: projectType || 'mod' }),
  addLocalProject: (filePath, projectType) =>
    invoke('add_local_project', { filePath, projectType: projectType || 'mod' }),
  checkModUpdates: (projectType) =>
    invoke('check_mod_updates', { projectType: projectType || null }),
  updateMod: (updateData) => invoke('update_mod', { updateData }),
  updateAllMods: (updatesList) => invoke('update_all_mods', { updatesList }),
  getModAvailableVersions: (projectId) =>
    invoke('get_mod_available_versions', { projectId }),

  // Modrinth API (Legacy aliases)
  searchMods: (query, mcVersion) =>
    invoke('search_modrinth', {
      query: query || '',
      mcVersion: mcVersion || '1.20.1',
      projectType: 'mod'
    }),
  installMod: (modId) =>
    invoke('install_modrinth_project', { projectId: modId, projectType: 'mod' }),

  // User custom mods (Legacy aliases)
  getUserMods: () => invoke('get_user_projects', { projectType: 'mod' }),
  toggleMod: (filename, enabled) =>
    invoke('toggle_project', { filename, enabled: !!enabled, projectType: 'mod' }),
  deleteMod: (filename) =>
    invoke('delete_project', { filename, projectType: 'mod' }),
  addLocalMod: (filePath) =>
    invoke('add_local_project', { filePath, projectType: 'mod' }),

  // Launch Minecraft
  launchGame: () => invoke('launch_game'),
  killGame: () => invoke('kill_game'),
  repairGame: () => invoke('repair_game'),

  // Launcher Updater
  checkForLauncherUpdates: () => invoke('check_for_launcher_updates'),
  installLauncherUpdate: () => invoke('install_launcher_update'),
  getLauncherReleaseNotes: () => invoke('get_launcher_release_notes'),
  getLauncherVersion: () => invoke('get_launcher_version'),
  onLauncherUpdateEvent: (callback) => safeListen('launcher-update-event', callback),

  // Event Listeners for Progress & Logs
  onPackSyncProgress: (callback) => safeListen('pack-sync-progress', callback),
  onLaunchProgress: (callback) => safeListen('launch-progress', callback),
  onGameLog: (callback) => safeListen('game-log', callback),
  onStatusMessage: (callback) => safeListen('status-message', callback),
  onConfigUpdated: (callback) => safeListen('config-updated', callback),

  // Tauri native file drop listener
  onFileDrop: safeOnDragDrop
};

window.api = tauriApi;
export default tauriApi;


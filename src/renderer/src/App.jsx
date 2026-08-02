import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { 
  Layout, 
  Settings as SettingsIcon, 
  Compass, 
  FolderHeart, 
  Terminal, 
  Minus, 
  Square, 
  X, 
  RefreshCw,
  Camera,
  ChevronDown
} from 'lucide-react';
import { THEMES, DEFAULT_THEME } from './themes';
// === OPTYMALIZACJA LAUNCHERA: lazy loading kart — każdy tab ładuje się dopiero przy pierwszym kliknięciu ===
// Na słabym PC skraca czas startowy launchera bo nie ładujemy wszystkich komponentów naraz
const Dashboard       = lazy(() => import('./components/Dashboard'));
const ModrinthBrowser = lazy(() => import('./components/ModrinthBrowser'));
const MyMods          = lazy(() => import('./components/MyMods'));
const Settings        = lazy(() => import('./components/Settings'));
const Screenshots     = lazy(() => import('./components/Screenshots'));
// Te ładujemy od razu bo są małe i mogą być potrzebne zaraz
import LogConsole from './components/LogConsole';
import FirstLaunchModal from './components/FirstLaunchModal';
import AccountSwitcherPanel from './components/AccountSwitcherPanel';
import AddOfflineAccountModal from './components/AddOfflineAccountModal';

// Funkcja aplikuje CSS Variables dla wybranego motywu na :root
function applyTheme(themeId) {
  const theme = THEMES[themeId] || THEMES[DEFAULT_THEME];
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  // Zmiana tła strony
  document.body.style.background = theme.vars['--color-bg'];
}

// Fallback spinner dla Suspense (minimalistyczny, nie obciąża GPU)
function TabSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
      <RefreshCw size={24} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [config, setConfig] = useState(null);
  const [statusMessage, setStatusMessage] = useState('Ładowanie konfiguracji...');
  const [packSyncProgress, setPackSyncProgress] = useState({ status: 'idle', progress: 0 });
  const [launchProgress, setLaunchProgress] = useState({ status: 'idle', progress: 0 });
  const [logs, setLogs] = useState([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [showAddOfflineModal, setShowAddOfflineModal] = useState(false);

  // Aplikowanie motywu przy zmianie config.theme
  useEffect(() => {
    if (config?.theme) {
      applyTheme(config.theme);
    }
  }, [config?.theme]);

  // Pobranie konfiguracji przy starcie
  useEffect(() => {
    async function loadConfig() {
      const currentConfig = await window.api.getConfig();
      setConfig(currentConfig);
      applyTheme(currentConfig.theme || DEFAULT_THEME);
      setStatusMessage('Launcher gotowy do gry');
    }
    loadConfig();

    const unsubStatus = window.api.onStatusMessage((msg) => setStatusMessage(msg));
    const unsubPackSync = window.api.onPackSyncProgress((data) => setPackSyncProgress(data));
    const unsubLaunch = window.api.onLaunchProgress((data) => setLaunchProgress(data));
    const unsubLog = window.api.onGameLog((log) => {
      setLogs((prev) => [...prev, log].slice(-1000));
    });

    return () => { unsubStatus(); unsubPackSync(); unsubLaunch(); unsubLog(); };
  }, []);

  // === OPTYMALIZACJA: useCallback zapobiega tworzeniu nowych funkcji przy każdym re-renderze ===
  const updateConfig = useCallback(async (newConfig) => {
    setConfig(newConfig);
    await window.api.saveConfig(newConfig);
  }, []);

  const handleLaunchGame = useCallback(async () => {
    if (!config.nickname) {
      alert("Proszę wpisać nick lub zalogować się przez Microsoft w Ustawieniach!");
      return;
    }
    if (launchProgress.status !== 'idle' && launchProgress.status !== 'error') return;

    setStatusMessage('Sprawdzanie spójności paczki modów...');
    const syncRes = await window.api.syncPack(false);
    if (!syncRes || !syncRes.success) {
      setStatusMessage('Błąd aktualizacji paczki: ' + (syncRes?.error || 'Nieznany błąd'));
      return;
    }
    const currentConfig = await window.api.getConfig();
    setConfig(currentConfig);
    setLogs([]);
    setLaunchProgress({ status: 'started', progress: 0 });
    const result = await window.api.launchGame();
    if (result && result.success === false) {
      setLaunchProgress({ status: 'error', error: result.error });
      setStatusMessage('Błąd uruchamiania gry: ' + result.error);
    }
  }, [config, launchProgress.status]);

  const handleKillGame = useCallback(async () => {
    const success = await window.api.killGame();
    if (success) {
      setLaunchProgress({ status: 'idle', progress: 0 });
      setStatusMessage('Proces gry został awaryjnie zakończony.');
    } else {
      setStatusMessage('Nie udało się zamknąć gry (lub proces już nie istnieje).');
    }
  }, []);

  const handleSyncPack = useCallback(async () => {
    if (launchProgress.status !== 'idle' && launchProgress.status !== 'error') return;
    setStatusMessage('Sprawdzanie aktualizacji paczki...');
    const syncRes = await window.api.syncPack(false);
    if (!syncRes || !syncRes.success) {
      setStatusMessage('Błąd aktualizacji paczki. Spróbuj ponownie.');
      return;
    }
    const currentConfig = await window.api.getConfig();
    setConfig(currentConfig);
    setLogs([]);
    await window.api.launchGame();
  }, [launchProgress.status]);

  // Przełączanie konta
  const handleSwitchAccount = useCallback(async (index) => {
    const res = await window.api.switchAccount({ index });
    if (res?.success && res.config) {
      setConfig(res.config);
    }
  }, []);

  // Dodanie konta offline
  const handleAddOfflineAccount = useCallback(async (nickname) => {
    const res = await window.api.addAccount({ type: 'offline', nickname, microsoftAuth: null });
    if (res?.success && res.config) {
      setConfig(res.config);
    }
    setShowAddOfflineModal(false);
  }, []);

  // Logowanie Microsoft (dodanie nowego konta premium)
  const handleAddMicrosoftAccount = useCallback(async () => {
    const res = await window.api.loginMicrosoft();
    if (res?.success) {
      const freshConfig = await window.api.getConfig();
      setConfig(freshConfig);
    }
  }, []);

  if (!config) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
        <div style={{ textAlign: 'center', color: '#f3f4f6' }}>
          <RefreshCw className="animate-spin" size={32} style={{ margin: '0 auto 16px', color: '#8b5cf6' }} />
          <p>Ładowanie launchera...</p>
        </div>
      </div>
    );
  }

  let displayStatus = 'Gotowy';
  if (packSyncProgress.status !== 'idle' && packSyncProgress.status !== 'error') {
    displayStatus = 'Synchronizacja...';
  } else if (launchProgress.status === 'java_download' || launchProgress.status === 'java_extract') {
    displayStatus = 'Pobieranie Javy...';
  } else if (launchProgress.status === 'game_download') {
    displayStatus = 'Pobieranie gry...';
  } else if (launchProgress.status === 'running') {
    displayStatus = 'W grze';
  }

  const isFirstLaunch = config && config.nickname === "" && config.loginType === "offline" && !config.microsoftAuth;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {isFirstLaunch && (
        <FirstLaunchModal
          config={config}
          onComplete={async (newConfig) => {
            setConfig(newConfig);
            // Auto-dodaj serwer po pierwszym uruchomieniu
            try { await window.api.addServerToMinecraft(); } catch(e) {}
          }}
        />
      )}

      {showAddOfflineModal && (
        <AddOfflineAccountModal
          onConfirm={handleAddOfflineAccount}
          onClose={() => setShowAddOfflineModal(false)}
        />
      )}

      {/* Customowy Pasek Tytułowy */}
      <div className="title-bar">
        <div className="title-bar-title">
          <img src="https://ciapongi.szablix.pl/instalacja/server-icon.png" width="18" height="18" alt="logo" style={{ marginRight: '6px', borderRadius: '4px' }} />
          <span>Ciapongi-RP</span> Launcher
        </div>
        <div className="title-bar-controls">
          <button className="window-btn" onClick={() => window.api.minimize()}><Minus size={14} /></button>
          <button className="window-btn" onClick={() => window.api.maximize()}><Square size={12} /></button>
          <button className="window-btn close-btn" onClick={() => window.api.close()}><X size={14} /></button>
        </div>
      </div>

      <div className="app-container">
        {/* Sidebar */}
        <div className="sidebar" style={{ position: 'relative' }}>
          <div className="sidebar-menu">
            <div style={{ padding: '0 12px 24px', fontSize: '18px', fontWeight: '800', background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textAlign: 'center' }}>
              CIAPONGI RP
            </div>
            <button className={`sidebar-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              <Layout size={18} />Pulpit
            </button>
            <button className={`sidebar-btn ${activeTab === 'modrinth' ? 'active' : ''}`} onClick={() => setActiveTab('modrinth')}>
              <Compass size={18} />Pobierz Dodatki (Modrinth)
            </button>
            <button className={`sidebar-btn ${activeTab === 'mymods' ? 'active' : ''}`} onClick={() => setActiveTab('mymods')}>
              <FolderHeart size={18} />Moje Pliki
            </button>
            <button className={`sidebar-btn ${activeTab === 'screenshots' ? 'active' : ''}`} onClick={() => setActiveTab('screenshots')}>
              <Camera size={18} />Zrzuty Ekranu
            </button>
            <button className={`sidebar-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
              <SettingsIcon size={18} />Ustawienia
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button className={`sidebar-btn ${isConsoleOpen ? 'active' : ''}`} onClick={() => setIsConsoleOpen(!isConsoleOpen)} style={{ width: '100%' }}>
              <Terminal size={18} />Konsola gry
            </button>

            {/* === AVATAR / ACCOUNT SWITCHER === */}
            <div
              className="sidebar-footer"
              onClick={() => setShowAccountSwitcher(v => !v)}
              style={{ cursor: 'pointer', userSelect: 'none', transition: 'background 0.15s', borderRadius: '10px', padding: '8px' }}
              title="Kliknij aby zmienić konto"
            >
              <div className="avatar">
                {config.nickname ? config.nickname[0].toUpperCase() : 'P'}
              </div>
              <div className="player-info" style={{ flex: 1, minWidth: 0 }}>
                <span className="player-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {config.nickname || 'Gracz'}
                </span>
                <span className="player-status">{displayStatus}</span>
              </div>
              <ChevronDown
                size={14}
                style={{
                  color: 'var(--text-muted)',
                  transform: showAccountSwitcher ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  flexShrink: 0
                }}
              />
            </div>

            {/* Panel przełączania kont */}
            {showAccountSwitcher && (
              <AccountSwitcherPanel
                config={config}
                onSwitch={handleSwitchAccount}
                onAddOffline={() => setShowAddOfflineModal(true)}
                onAddMicrosoft={handleAddMicrosoftAccount}
                onClose={() => setShowAccountSwitcher(false)}
              />
            )}
          </div>
        </div>

        {/* Main Content Area — Suspense z lekkim spinnerem */}
        <div className="main-content">
          <Suspense fallback={<TabSpinner />}>
            {activeTab === 'dashboard' && (
              <Dashboard
                config={config}
                statusMessage={statusMessage}
                packSyncProgress={packSyncProgress}
                launchProgress={launchProgress}
                onLaunch={handleLaunchGame}
                onKill={handleKillGame}
                onSync={handleSyncPack}
                onSave={updateConfig}
              />
            )}
            {activeTab === 'modrinth' && <ModrinthBrowser config={config} />}
            {activeTab === 'mymods' && <MyMods config={config} />}
            {activeTab === 'screenshots' && <Screenshots />}
            {activeTab === 'settings' && <Settings config={config} onSave={updateConfig} />}
          </Suspense>
        </div>

        <LogConsole isOpen={isConsoleOpen} onClose={() => setIsConsoleOpen(false)} logs={logs} />
      </div>
    </div>
  );
}

export default App;

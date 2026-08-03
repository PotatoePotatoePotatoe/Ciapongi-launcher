import React, { useState, useEffect } from 'react';
import { Save, AlertCircle, FolderOpen, RefreshCw, Cpu, Sparkles, Palette, User, ChevronDown } from 'lucide-react';
import { THEMES } from '../themes';

function getCoresLabel(cores) {
  if (cores === 1) return 'wątek';
  if ([2, 3, 4].includes(cores % 10) && ![12, 13, 14].includes(cores % 100)) return 'wątki';
  return 'wątków';
}

function Settings({ config, onSave }) {
  const isWin = window.api?.platform === 'win32' || !window.api?.platform;
  const [nickname, setNickname] = useState(config.nickname);
  const [ram, setRam] = useState(config.ram);
  const [githubToken, setGithubToken] = useState(config.githubToken);
  const [gameDir, setGameDir] = useState(config.gameDir);
  const [javaPath, setJavaPath] = useState(config.javaPath);
  const [minecraftVersion, setMinecraftVersion] = useState(config.minecraftVersion);
  const [loaderVersion, setLoaderVersion] = useState(config.loaderVersion);
  const [javaVersion, setJavaVersion] = useState(config.javaVersion || 'auto');
  const [potatoMode, setPotatoMode] = useState(config.potatoMode || false);
  const [disableAutoUpdate, setDisableAutoUpdate] = useState(config.disableAutoUpdate || false);
  const [autoUpdateLauncher, setAutoUpdateLauncher] = useState(config.autoUpdateLauncher !== false);
  const [jvmProfile, setJvmProfile] = useState(config.jvmProfile || 'auto');
  const [loginType, setLoginType] = useState(config.loginType || 'offline');
  const [microsoftAuth, setMicrosoftAuth] = useState(config.microsoftAuth || null);
  const [theme, setTheme] = useState(config.theme || 'dark-violet');
  const [customColors, setCustomColors] = useState(config.customColors || { primary: '#8b5cf6', secondary: '#06b6d4' });
  const [systemRam, setSystemRam] = useState(16384);
  const [systemSpecs, setSystemSpecs] = useState({ cpu: 'Wyszukiwanie...', cores: 0, ram: 0, gpu: 'Nieznana' });
  const [saved, setSaved] = useState(false);
  const [autoApplied, setAutoApplied] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [installingMods, setInstallingMods] = useState(false);
  const [installStatus, setInstallStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState('idle');
  const [updaterProgress, setUpdaterProgress] = useState(0);
  const [updaterMessage, setUpdaterMessage] = useState('');

  const installRecommendedModsPackage = async () => {
    setInstallingMods(true);
    setInstallStatus('Inicjalizacja pobierania pakietu optymalizacji...');

    const modsToInstall = [
      { id: 'yacl', name: 'YetAnotherConfigLib (YACL)' },
      { id: 'cloth-config', name: 'Cloth Config API' },
      { id: 'indium', name: 'Indium' },
      { id: 'modernfix', name: 'ModernFix' },
      { id: 'ebe', name: 'Enhanced Block Entities' },
      { id: 'cull-less-leaves', name: 'Cull Less Leaves' },
      { id: 'fastanim', name: 'FastAnim' },
      { id: 'ferrite-core', name: 'FerriteCore' },
      { id: 'krypton', name: 'Krypton' },
      { id: 'lithium', name: 'Lithium' },
      { id: 'memoryleakfix', name: 'Memory Leak Fix' },
      { id: 'noisium', name: 'Noisiumed' },
      { id: 'entityculling', name: 'Entity Culling' }
    ];

    let installedCount = 0;
    let errors = [];

    for (let i = 0; i < modsToInstall.length; i++) {
      const mod = modsToInstall[i];
      setInstallStatus(`[${i + 1}/${modsToInstall.length}] Pobieranie / sprawdzanie ${mod.name}...`);
      try {
        const res = await window.api.installModrinthProject(mod.id, 'mod');
        if (res.success) {
          installedCount++;
        } else if (res.error && (res.error.includes('jest już częścią') || res.error.includes('jest już zainstalowany'))) {
          installedCount++;
        } else {
          errors.push(`${mod.name}: ${res.error}`);
        }
      } catch (err) {
        if (err.message && (err.message.includes('jest już częścią') || err.message.includes('jest już zainstalowany'))) {
          installedCount++;
        } else {
          errors.push(`${mod.name}: ${err.message}`);
        }
      }
    }

    setInstallingMods(false);
    if (errors.length === 0) {
      setInstallStatus(`✅ Pełen pakiet 10 modów optymalizacyjnych jest gotowy i aktywny! (${installedCount}/${modsToInstall.length})`);
    } else {
      setInstallStatus(`⚠️ Zainstalowano/potwierdzono ${installedCount}/${modsToInstall.length} modów. Błędy: ${errors.join('; ')}`);
    }
  };

  useEffect(() => {
    setNickname(config.nickname);
    setRam(config.ram);
    setGithubToken(config.githubToken);
    setGameDir(config.gameDir);
    setJavaPath(config.javaPath);
    setMinecraftVersion(config.minecraftVersion);
    setLoaderVersion(config.loaderVersion);
    setJavaVersion(config.javaVersion || 'auto');
    setPotatoMode(config.potatoMode || false);
    setDisableAutoUpdate(config.disableAutoUpdate || false);
    setAutoUpdateLauncher(config.autoUpdateLauncher !== false);
    setJvmProfile(config.jvmProfile || 'auto');
    setLoginType(config.loginType || 'offline');
    setMicrosoftAuth(config.microsoftAuth || null);
    setTheme(config.theme || 'dark-violet');
    setCustomColors(config.customColors || { primary: '#8b5cf6', secondary: '#06b6d4' });
  }, [config]);

  useEffect(() => {
    if (window.api && window.api.onLauncherUpdateEvent) {
      const cleanup = window.api.onLauncherUpdateEvent((data) => {
        setUpdaterStatus(data.status);
        if (data.status === 'downloading') {
          setUpdaterProgress(data.progress || 0);
        } else if (data.status === 'error') {
          setUpdaterMessage(data.error);
        } else if (data.status === 'available') {
          setUpdaterMessage(`Dostępna nowa wersja: ${data.info?.version || ''}`);
        } else if (data.status === 'not-available') {
          setUpdaterMessage('Posiadasz najnowszą wersję.');
        } else if (data.status === 'downloaded') {
          setUpdaterMessage('Gotowe do instalacji. Zrestartuj launcher.');
        }
      });
      return cleanup;
    }
  }, []);

  useEffect(() => {
    async function fetchSystemSpecs() {
      try {
        const specs = await window.api.getSystemSpecs();
        setSystemSpecs(specs);
        setSystemRam(specs.ram);
      } catch (e) {
        console.error('Błąd podczas pobierania specyfikacji systemu:', e);
      }
    }
    fetchSystemSpecs();
  }, []);

  // Generuje i aplikuje CSS vars dla wlasnego koloru — podglad na zywo
  const applyCustomTheme = (primary, secondary) => {
    const hexToRgb = (hex) => ({
      r: parseInt(hex.slice(1,3), 16),
      g: parseInt(hex.slice(3,5), 16),
      b: parseInt(hex.slice(5,7), 16),
    });
    const { r: pr, g: pg, b: pb } = hexToRgb(primary);
    const { r: sr, g: sg, b: sb } = hexToRgb(secondary);
    const root = document.documentElement;
    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-primary-glow', `rgba(${pr},${pg},${pb},0.25)`);
    root.style.setProperty('--color-secondary', secondary);
    root.style.setProperty('--color-secondary-glow', `rgba(${sr},${sg},${sb},0.25)`);
    root.style.setProperty('--gradient-primary', `linear-gradient(135deg, ${primary}, ${secondary})`);
    const bgR = Math.max(0, Math.floor(pr * 0.04));
    const bgG = Math.max(0, Math.floor(pg * 0.04));
    const bgB = Math.max(0, Math.floor(pb * 0.07));
    root.style.setProperty('--color-bg', `rgb(${bgR},${bgG},${bgB})`);
    root.style.setProperty('--color-sidebar-bg', `rgba(${bgR},${bgG},${bgB},0.97)`);
    document.body.style.background = `rgb(${bgR},${bgG},${bgB})`;
  };

  const handleSave = () => {
    onSave({
      ...config,
      nickname,
      ram: parseInt(ram, 10),
      githubToken,
      gameDir,
      javaPath,
      minecraftVersion,
      loaderVersion,
      javaVersion,
      potatoMode,
      disableAutoUpdate,
      autoUpdateLauncher,
      jvmProfile,
      loginType,
      microsoftAuth,
      theme,
      customColors,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleCheckLauncherUpdates = async () => {
    setUpdaterStatus('checking');
    setUpdaterMessage('');
    if (window.api && window.api.checkForLauncherUpdates) {
      const res = await window.api.checkForLauncherUpdates();
      if (!res.success) {
        setUpdaterStatus('error');
        setUpdaterMessage(res.error);
      }
    }
  };

  const handleInstallLauncherUpdate = async () => {
    if (window.api && window.api.installLauncherUpdate) {
      await window.api.installLauncherUpdate();
    }
  };

  const handleMicrosoftLogin = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await window.api.loginMicrosoft();
      if (res.success) {
        const freshConfig = await window.api.getConfig();
        setLoginType(freshConfig.loginType);
        setMicrosoftAuth(freshConfig.microsoftAuth);
        setNickname(freshConfig.nickname);
        onSave(freshConfig);
      } else {
        setLoginError(res.error || 'Błąd logowania Microsoft.');
      }
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleMicrosoftLogout = () => {
    setLoginType('offline');
    setMicrosoftAuth(null);
    setNickname('Gracz');
    onSave({ ...config, loginType: 'offline', microsoftAuth: null, nickname: 'Gracz' });
  };

  const getRecommendations = (totalRamMb) => {
    if (totalRamMb <= 4500) return { ramMb: 2048, ramGb: '2.0', profile: 'potato', profileName: 'Potato GC' };
    if (totalRamMb <= 8500) return { ramMb: 4096, ramGb: '4.0', profile: 'potato', profileName: 'Potato GC' };
    if (totalRamMb <= 12500) return { ramMb: 6144, ramGb: '6.0', profile: 'optimized_g1gc', profileName: 'Optimized G1GC' };
    if (totalRamMb <= 16500) return { ramMb: 8192, ramGb: '8.0', profile: 'optimized_g1gc', profileName: 'Optimized G1GC' };
    return { ramMb: 10240, ramGb: '10.0', profile: 'extreme_zgc', profileName: 'Extreme ZGC' };
  };

  const applyHardwareRecommendations = () => {
    const recs = getRecommendations(systemSpecs.ram);
    setRam(recs.ramMb);
    setJvmProfile(recs.profile);
    setAutoApplied(true);
    setTimeout(() => setAutoApplied(false), 3000);
  };

  const isRamTooHigh = ram > systemRam * 0.85;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>

      {/* Header */}
      <div>
        <h2 style={{ fontSize: '24px', fontWeight: '800' }}>Ustawienia launchera</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
          Dostosuj parametry uruchamiania gry Minecraft oraz parametry synchronizacji paczki modów.
        </p>
      </div>

      <div style={{ flexGrow: 1, overflowY: 'auto' }} className="custom-scroll">
        <div className="settings-layout">

          {/* ═══════════════ LEWA KOLUMNA ═══════════════ */}
          <div className="settings-col">

            {/* Alokacja pamięci RAM */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Alokacja pamięci RAM</label>
                <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--color-secondary)' }}>
                  {(ram / 1024).toFixed(1)} GB / {(systemRam / 1024).toFixed(0)} GB
                </span>
              </div>

              <div className="range-slider-container">
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>1 GB</span>
                <input
                  type="range"
                  className="range-slider"
                  min={1024}
                  max={systemRam}
                  step={512}
                  value={ram}
                  onChange={(e) => setRam(parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{Math.floor(systemRam / 1024)} GB</span>
              </div>

              {isRamTooHigh && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning)', fontSize: '12px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <AlertCircle size={14} />
                  <span>Ostrzeżenie: Przydzielenie ponad 85% pamięci systemowej może spowolnić działanie komputera.</span>
                </div>
              )}
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Zalecana alokacja dla paczek modów to 6-8 GB (6144 - 8192 MB).
              </span>

              <div style={{ height: '1px', background: 'var(--border-color)', margin: '8px 0' }}></div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '80%' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Oszczędzanie zasobów w tle (Ukryj launcher podczas gry)</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Całkowicie ukrywa interfejs launchera w tle podczas rozgrywki, zwalniając około 200 MB pamięci RAM oraz odciążając procesor i kartę graficzną.
                  </span>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={potatoMode} onChange={() => setPotatoMode(!potatoMode)} />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ height: '1px', background: 'var(--border-color)', margin: '8px 0' }}></div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '80%' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Wyłącz automatyczne aktualizacje paczki</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Pomija pobieranie modpacka przy uruchamianiu gry. Włącz to, jeśli zmieniłeś własne mody i nie chcesz, aby launcher je nadpisywał.
                  </span>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={disableAutoUpdate} onChange={() => setDisableAutoUpdate(!disableAutoUpdate)} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            {/* Aktualizacje Launchera */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '12px', flexGrow: 1 }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8' }}>
                    <RefreshCw size={20} className={updaterStatus === 'checking' || updaterStatus === 'downloading' ? 'spin' : ''} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h4 style={{ fontSize: '15px', fontWeight: '700', margin: 0, color: 'var(--text-main)' }}>Aktualizacje Launchera</h4>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Sprawdź, czy dostępna jest nowa wersja launchera.<br/>
                      Zawsze możesz ręcznie sprawdzić najnowsze wydanie.
                    </span>
                    
                    {updaterMessage && (
                      <span style={{ fontSize: '12px', fontWeight: '600', color: updaterStatus === 'error' ? 'var(--color-danger)' : 'var(--color-success)', marginTop: '4px' }}>
                        {updaterMessage}
                      </span>
                    )}
                    {updaterStatus === 'downloading' && (
                      <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                        <div style={{ width: `${updaterProgress}%`, height: '100%', background: '#38bdf8', transition: 'width 0.2s' }}></div>
                      </div>
                    )}
                  </div>
                </div>
                
                {updaterStatus === 'downloaded' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleInstallLauncherUpdate}
                    style={{ padding: '0 16px', height: '36px', fontSize: '13px', whiteSpace: 'nowrap' }}
                  >
                    Instaluj i uruchom ponownie
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleCheckLauncherUpdates}
                    disabled={updaterStatus === 'checking' || updaterStatus === 'downloading'}
                    style={{ padding: '0 16px', height: '36px', border: '1px solid var(--border-color)', fontSize: '13px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RefreshCw size={14} className={updaterStatus === 'checking' ? 'spin' : ''} />
                    Sprawdź aktualizacje
                  </button>
                )}
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '12px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '80%' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)' }}>Pobieraj aktualizacje automatycznie w tle</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Wyłączenie tej opcji sprawi, że launcher będzie pytał przed pobraniem plików.
                  </span>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={autoUpdateLauncher} onChange={() => setAutoUpdateLauncher(!autoUpdateLauncher)} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            {/* Ustawienia zaawansowane */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div 
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                  Ustawienia zaawansowane
                </h3>
                <ChevronDown size={18} style={{ color: 'var(--text-muted)', transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} />
              </div>

              {showAdvanced && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '4px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Katalog gry (.minecraft)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={gameDir}
                    onChange={(e) => setGameDir(e.target.value)}
                    style={{ flexGrow: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={async () => {
                      const selected = await window.api.selectDirectory();
                      if (selected) setGameDir(selected);
                    }}
                    style={{ padding: '0 16px', gap: '6px', height: '46px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center' }}
                    title="Wybierz folder z dysku"
                  >
                    <FolderOpen size={16} />
                    <span>Wybierz</span>
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Wersja Javy</label>
                <select
                  className="form-input"
                  value={javaVersion}
                  onChange={(e) => setJavaVersion(e.target.value)}
                  style={{ width: '100%', height: '46px', background: 'rgba(25, 25, 35, 0.9)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '10px', outline: 'none' }}
                >
                  <option value="auto">Automatyczna (zależna od wersji Minecrafta)</option>
                  <option value="17">Java 17 (LTS — MC 1.17 – 1.20.4, w tym 1.20.1 ✓)</option>
                  <option value="21">Java 21 (LTS — MC 1.20.5+, eksperymentalnie 1.20.1)</option>
                </select>
                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5', paddingBottom: '4px', marginTop: '4px' }}>
                  Java 17 jest oficjalnie wymaganą wersją dla Minecraft 1.20.1. Java 21 działa, lecz może powodować problemy z niektórymi modami. Przy zmianie wersja zostanie pobrana automatycznie.
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Niestandardowa ścieżka do Javy ({isWin ? 'java.exe' : 'java'})</label>
                <input
                  type="text"
                  className="form-input"
                  value={javaPath}
                  onChange={(e) => setJavaPath(e.target.value)}
                  placeholder="Pozostaw puste, aby używać wbudowanej Javy"
                  style={{ height: '46px' }}
                />
                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5', paddingBottom: '4px', marginTop: '4px' }}>
                  Wypełnij tylko wtedy, gdy chcesz wskazać własny plik `{isWin ? 'java.exe' : 'java'}` zainstalowany ręcznie na komputerze.
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Profil flag JVM (Java Garbage Collector)</label>
                <select
                  className="form-input"
                  value={jvmProfile}
                  onChange={(e) => setJvmProfile(e.target.value)}
                  style={{ width: '100%', height: '46px', background: 'rgba(25, 25, 35, 0.9)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '10px', outline: 'none' }}
                >
                  <option value="auto">Automatyczny (Rekomendowany dla Twojego sprzętu)</option>
                  <option value="none">Brak (Domyślne parametry Javy)</option>
                  <option value="ultra_potato">⚠️ Ultra Potato (Ekstremalnie słabe PC, ≤4GB RAM)</option>
                  <option value="potato">Słaby PC (Potato GC - najniższe zużycie RAM)</option>
                  <option value="optimized_g1gc">Zoptymalizowany G1GC (Aikar's - stabilniejsze klatki, zalecany)</option>
                  <option value="extreme_zgc">Ekstremalny ZGC (Najniższe opóźnienia, dla mocnych PC i Javy 17/21)</option>
                </select>
                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5', paddingBottom: '4px', marginTop: '4px' }}>
                  Zoptymalizowane argumenty uruchamiania Javy pomagają wyeliminować mikroprzycięcia (stuttering) spowodowane odśmiecaniem pamięci.
                </span>
              </div>
                </div>
              )}
            </div>

          </div> {/* koniec lewej kolumny */}

          {/* ═══════════════ PRAWA KOLUMNA ═══════════════ */}
          <div className="settings-col">

            {/* ═══════════════ MOTYWY GUI ═══════════════ */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
                  <Palette size={18} />
                </div>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0 }}>Wygląd interfejsu (Motyw)</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0' }}>Zmiana jest natychmiastowa — nie trzeba zapisywać.</p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(85px, 1fr))', gap: '10px' }}>
                {Object.entries(THEMES).map(([id, t]) => {
                  const isActive = theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setTheme(id);
                        // Natychmiastowy podgląd bez zapisywania
                        const root = document.documentElement;
                        Object.entries(t.vars).forEach(([k, v]) => root.style.setProperty(k, v));
                        document.body.style.background = t.vars['--color-bg'];
                      }}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                        padding: '12px 8px', borderRadius: '12px', cursor: 'pointer',
                        border: isActive ? '2px solid var(--color-primary)' : '2px solid rgba(255,255,255,0.06)',
                        background: isActive ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                        transition: 'all 0.2s',
                      }}
                    >
                      {/* Podgląd kolorów */}
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: t.preview[0] }} />
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: t.preview[1] }} />
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: '600', color: isActive ? 'var(--color-primary)' : 'var(--text-muted)', textAlign: 'center', lineHeight: '1.2' }}>
                        {t.label}
                      </span>
                    </button>
                  );
                })}

                {/* Kafelek: Własny kolor */}
                <button
                  type="button"
                  onClick={() => {
                    setTheme('custom');
                    applyCustomTheme(customColors.primary, customColors.secondary);
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                    padding: '12px 8px', borderRadius: '12px', cursor: 'pointer',
                    border: theme === 'custom' ? '2px solid var(--color-primary)' : '2px dashed rgba(255,255,255,0.15)',
                    background: theme === 'custom' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: customColors.primary }} />
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: customColors.secondary }} />
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: theme === 'custom' ? 'var(--color-primary)' : 'var(--text-muted)', textAlign: 'center', lineHeight: '1.2' }}>
                    Własny
                  </span>
                </button>
              </div>

              {/* Panel wyboru kolorow — widoczny tylko gdy aktywny jest motyw 'custom' */}
              {theme === 'custom' && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '14px', animation: 'fadeIn 0.2s ease' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>🎨 Własna paleta kolorów</span>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '120px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Kolor główny (akcent)</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="color"
                          value={customColors.primary}
                          onChange={(e) => {
                            const val = e.target.value;
                            const next = { ...customColors, primary: val };
                            setCustomColors(next);
                            applyCustomTheme(val, customColors.secondary);
                          }}
                          style={{ width: '40px', height: '36px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '2px', background: 'transparent' }}
                        />
                        <span style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>{customColors.primary}</span>
                      </div>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '120px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Kolor dodatkowy (gradient)</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="color"
                          value={customColors.secondary}
                          onChange={(e) => {
                            const val = e.target.value;
                            const next = { ...customColors, secondary: val };
                            setCustomColors(next);
                            applyCustomTheme(customColors.primary, val);
                          }}
                          style={{ width: '40px', height: '36px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '2px', background: 'transparent' }}
                        />
                        <span style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>{customColors.secondary}</span>
                      </div>
                    </label>
                  </div>
                  {/* Pasek podgladu gradientu */}
                  <div style={{ height: '6px', borderRadius: '3px', background: `linear-gradient(90deg, ${customColors.primary}, ${customColors.secondary})` }} />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Kliknij „Zapisz ustawienia" aby zachować własny motyw na stałe.
                  </span>
                </div>
              )}
            </div>


            {/* Wykryta specyfikacja komputera */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(6, 182, 212, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-secondary)' }}>
                  <Cpu size={20} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                  <h4 style={{ fontSize: '15px', fontWeight: '700', margin: 0, color: 'var(--text-main)' }}>Wykryta specyfikacja komputera</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0', lineHeight: '1.4' }}>
                    Procesor: <span style={{ color: 'var(--text-main)' }}>{systemSpecs.cpu} ({systemSpecs.cores} {getCoresLabel(systemSpecs.cores)})</span><br />
                    Karta graficzna: <span style={{ color: 'var(--text-main)' }}>{systemSpecs.gpu}</span> | RAM: <span style={{ color: 'var(--text-main)' }}>{(systemSpecs.ram / 1024).toFixed(1)} GB</span>
                  </p>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '12px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Rekomendacja systemowa</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--color-secondary)' }}>
                    Alokacja {(getRecommendations(systemSpecs.ram).ramMb / 1024).toFixed(1)} GB RAM & Profil JVM: {getRecommendations(systemSpecs.ram).profileName}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {autoApplied && (
                    <span className="fade-in" style={{ color: 'var(--color-success)', fontSize: '12px', fontWeight: '600' }}>Zastosowano!</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={applyHardwareRecommendations}
                    style={{ padding: '0 12px', gap: '6px', height: '36px', border: '1px solid var(--border-color)', fontSize: '13px', display: 'flex', alignItems: 'center' }}
                    title="Automatycznie dostosuj suwak RAM oraz profil flag uruchamiania JVM"
                  >
                    <RefreshCw size={14} />
                    <span>Dopasuj automatycznie</span>
                  </button>
                </div>
              </div>

              {/* Pakiet modów optymalizacyjnych */}
              <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  ⚡ Pełen Pakiet 10 Modyfikacji Optymalizacyjnych (Fabric + Create & MTR)
                </span>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontWeight: '700', fontSize: '12px', color: '#38bdf8' }}>Lithium & FerriteCore</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Optymalizacja silnika TPS & redukcja zużycia RAM modeli o 50%.</div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontWeight: '700', fontSize: '12px', color: '#38bdf8' }}>EntityCulling & EBE</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Optymalne renderowanie pociągów MTR, skrzyń i niewidocznych bytów.</div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontWeight: '700', fontSize: '12px', color: '#38bdf8' }}>ModernFix & FastAnim</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Szybsze o 50% ładowanie Create & optymalne animacje bytów.</div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontWeight: '700', fontSize: '12px', color: '#38bdf8' }}>Krypton, Noisium, MemoryLeakFix, CullLeaves</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Szybsza sieć, generowanie biomów i naprawa wycieków pamięci.</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={installRecommendedModsPackage}
                    disabled={installingMods}
                    style={{
                      width: '100%', padding: '12px', gap: '8px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                      color: '#ffffff', border: 'none', borderRadius: '8px',
                      fontWeight: '700', fontSize: '13px',
                      cursor: installingMods ? 'wait' : 'pointer',
                      boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)'
                    }}
                  >
                    {installingMods ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />}
                    <span>{installingMods ? 'Pobieranie i instalacja 10 modów...' : 'Zainstaluj automatycznie zalecany pakiet 10 modów optymalizacyjnych (1-Kliknięcie)'}</span>
                  </button>
                  {installStatus && (
                    <div style={{
                      fontSize: '12px', textAlign: 'center', fontWeight: '600',
                      padding: '6px 10px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)',
                      color: installStatus.startsWith('✅') ? '#4ade80' : installStatus.startsWith('⚠️') ? '#facc15' : '#38bdf8'
                    }}>
                      {installStatus}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div> {/* koniec prawej kolumny */}

        </div>

        {/* Przycisk zapisu — poza kolumnami, na dole */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '24px', paddingBottom: '32px' }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ gap: '8px', minWidth: '160px' }}>
            <Save size={16} />
            Zapisz ustawienia
          </button>
          {saved && (
            <span className="fade-in" style={{ color: 'var(--color-success)', fontSize: '14px', fontWeight: '600' }}>
              Ustawienia zostały zapisane!
            </span>
          )}
        </div>

      </div>

    </div>
  );
}

export default Settings;

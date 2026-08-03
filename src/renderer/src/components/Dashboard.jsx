import React, { useState, useEffect } from 'react';
import { Play, RefreshCw, Layers, ShieldCheck, HelpCircle, Wifi, FolderOpen, DownloadCloud, ChevronDown } from 'lucide-react';
import ciapongiBg from '../../assets/ciapongi_bg.png';

function Dashboard({ config, statusMessage, packSyncProgress, launchProgress, onLaunch, onKill, onSync, onSave }) {
  const [serverStatus, setServerStatus] = useState({ online: false, players: { online: 0, max: 100 }, version: 'Loading...', loading: true });

  const [releaseNotes, setReleaseNotes] = useState(null);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [launcherNotes, setLauncherNotes] = useState(null);
  const [loadingLauncherNotes, setLoadingLauncherNotes] = useState(true);
  const [packVersions, setPackVersions] = useState([]);
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);

  useEffect(() => {
    async function updateStatus() {
      try {
        const status = await window.api.getServerStatus();
        setServerStatus({ ...status, loading: false });
      } catch (err) {
        console.error("Błąd podczas odpytywania o status serwera:", err);
        setServerStatus({ online: false, players: { online: 0, max: 100 }, version: 'Offline', loading: false });
      }
    }
    updateStatus();
    const interval = setInterval(updateStatus, 30000); // co 30 sekund
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function loadReleaseNotes() {
      try {
        const notes = await window.api.getLatestReleaseNotes();
        setReleaseNotes(notes);
      } catch (err) {
        console.error("Błąd podczas wczytywania listy zmian paczki:", err);
      } finally {
        setLoadingNotes(false);
      }
    }
    loadReleaseNotes();
    
    async function loadLauncherNotes() {
      try {
        const lNotes = await window.api.getLauncherReleaseNotes();
        setLauncherNotes(lNotes);
      } catch (err) {
        console.error("Błąd podczas wczytywania listy zmian launchera:", err);
      } finally {
        setLoadingLauncherNotes(false);
      }
    }
    loadLauncherNotes();
    
    async function loadPackVersions() {
      try {
        const versions = await window.api.getPackVersions();
        setPackVersions(versions);
      } catch (err) {
        console.error("Błąd podczas pobierania wersji:", err);
      }
    }
    loadPackVersions();
  }, []);


  const formatBytes = (bytes) => {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec) => {
    if (bytesPerSec === 0 || !bytesPerSec) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const activeProgress =
    packSyncProgress.status === 'downloading' ? packSyncProgress :
      launchProgress.status === 'java_download' ? launchProgress : null;

  const showStats = activeProgress && activeProgress.total > 0;

  // Funkcja określająca zawartość przycisku graj
  const getPlayButtonText = () => {
    if (packSyncProgress.status === 'downloading') {
      return `Pobieranie paczki: ${packSyncProgress.progress}%`;
    }
    if (packSyncProgress.status === 'extracting') {
      return 'Instalowanie paczki...';
    }
    if (launchProgress.status === 'java_download') {
      return `Pobieranie Java: ${launchProgress.progress}%`;
    }
    if (launchProgress.status === 'java_extract') {
      return 'Instalowanie Java...';
    }
    if (launchProgress.status === 'game_download') {
      return `Pobieranie gry: ${launchProgress.progress}%`;
    }
    if (launchProgress.status === 'running') {
      return 'Gra jest włączona';
    }
    return 'URUCHOM GRĘ';
  };

  const isWorking =
    (packSyncProgress.status !== 'idle' && packSyncProgress.status !== 'error') ||
    (launchProgress.status !== 'idle' && launchProgress.status !== 'error' && launchProgress.status !== 'running');

  // Obliczanie ogólnego postępu
  const getProgressPercentage = () => {
    if (packSyncProgress.status === 'downloading') return packSyncProgress.progress;
    if (packSyncProgress.status === 'extracting') return 95;
    if (launchProgress.status === 'java_download') return launchProgress.progress;
    if (launchProgress.status === 'java_extract') return 95;
    if (launchProgress.status === 'game_download') return launchProgress.progress;
    if (launchProgress.status === 'running') return 100;
    return 0;
  };

  const progress = getProgressPercentage();

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Banner główny */}
      <div className="glass-card" style={{
        backgroundImage: `linear-gradient(rgba(13, 13, 20, 0.7), rgba(13, 13, 20, 0.9)), url(${ciapongiBg})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
        height: '220px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: '8px',
        padding: '32px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <img
            src="https://ciapongi.szablix.pl/instalacja/server-icon.png"
            style={{ width: '64px', height: '64px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}
            alt="server-icon"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge badge-secondary">Ciapongi RP</span>
              <span className="badge badge-primary">Fabric {config.loaderVersion}</span>
            </div>
            <h1 style={{ fontSize: '28px', fontWeight: '800', textShadow: '0 2px 10px rgba(0,0,0,0.5)', marginTop: '4px' }}>
              Witaj na serwerze, {config.nickname}!
            </h1>
          </div>
        </div>
        <p style={{ color: '#d1d5db', fontSize: '14px', maxWidth: '600px', textShadow: '0 1px 5px rgba(0,0,0,0.5)' }}>
          Launcher automatycznie pobierze najnowszą paczkę modów z GitHub, skonfiguruje Javę oraz uruchomi grę. Możesz także dodać swoje własne mody!
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Sekcja startu gry */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '24px', padding: '40px', width: '100%' }}>

          <div style={{ display: 'flex', gap: '16px' }}>
            <button
              className="btn btn-primary"
              onClick={onLaunch}
              disabled={isWorking || launchProgress.status === 'running'}
              style={{
                width: launchProgress.status === 'running' ? '180px' : '240px',
                height: '64px',
                borderRadius: '32px',
                fontSize: '18px',
                letterSpacing: '0.5px',
                gap: '12px',
                boxShadow: isWorking ? 'none' : '0 8px 30px color-mix(in srgb, var(--color-primary) 40%, transparent)',
                transition: 'all 0.3s ease'
              }}
            >
              {isWorking ? (
                <RefreshCw className="animate-spin" size={20} />
              ) : (
                <Play fill="currentColor" size={20} />
              )}
              {getPlayButtonText()}
            </button>

            {launchProgress.status === 'running' && (
              <button
                className="btn btn-primary fade-in"
                onClick={onKill}
                style={{
                  width: '140px',
                  height: '64px',
                  borderRadius: '32px',
                  fontSize: '16px',
                  letterSpacing: '0.5px',
                  gap: '8px',
                  background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                  boxShadow: '0 8px 30px rgba(239, 68, 68, 0.4)',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                Zabij Grę
              </button>
            )}
          </div>

          {/* Pasek postępu */}
          {isWorking && (
            <div style={{ width: '100%', maxWidth: '450px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                <span>Pobieranie plików...</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                <div style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))',
                  borderRadius: '4px',
                  boxShadow: '0 0 10px rgba(6, 182, 212, 0.5)',
                  transition: 'width 0.3s ease'
                }}></div>
              </div>
              {showStats && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  <span>{formatBytes(activeProgress.transferred)} / {formatBytes(activeProgress.total)}</span>
                  <span>{formatSpeed(activeProgress.speed)}</span>
                </div>
              )}
            </div>
          )}

          {/* Logi/Status pod przyciskiem */}
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', fontWeight: '500', lineHeight: '1.5', paddingBottom: '12px', minHeight: '28px' }}>
            {statusMessage}
          </div>
        </div>

        {/* Karta z listą zmian paczki (Release Notes) */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '800', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Co nowego w paczce?</span>
            <span style={{ fontSize: '11px', background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)', padding: '2px 8px', borderRadius: '8px' }}>
              {releaseNotes ? releaseNotes.tag_name : 'Wczytywanie...'}
            </span>
          </h3>
          {loadingNotes ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <RefreshCw className="animate-spin" size={18} style={{ color: 'var(--color-primary)' }} />
            </div>
          ) : releaseNotes ? (
            <div className="custom-scroll" style={{ maxHeight: '180px', overflowY: 'auto', textAlign: 'left', fontSize: '13px', lineHeight: '1.6', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', paddingRight: '6px' }}>
              <h4 style={{ color: 'var(--text-main)', fontWeight: '700', marginBottom: '8px', fontSize: '14px' }}>{releaseNotes.name}</h4>
              {releaseNotes.body}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '10px 0' }}>
              Brak dostępnych informacji o zmianach w paczce.
            </div>
          )}
        </div>

        {/* Karta z listą zmian launchera */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '800', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Ostatnie zmiany w launcherze</span>
            <span style={{ fontSize: '11px', background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)', padding: '2px 8px', borderRadius: '8px' }}>
              {launcherNotes ? launcherNotes.tag_name : 'Wczytywanie...'}
            </span>
          </h3>
          {loadingLauncherNotes ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <RefreshCw className="animate-spin" size={18} style={{ color: 'var(--color-primary)' }} />
            </div>
          ) : launcherNotes ? (
            <div className="custom-scroll" style={{ maxHeight: '180px', overflowY: 'auto', textAlign: 'left', fontSize: '13px', lineHeight: '1.6', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', paddingRight: '6px' }}>
              <h4 style={{ color: 'var(--text-main)', fontWeight: '700', marginBottom: '8px', fontSize: '14px' }}>{launcherNotes.name}</h4>
              {launcherNotes.body}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '10px 0' }}>
              Brak dostępnych informacji o zmianach launchera.
            </div>
          )}
        </div>
      </div>

        {/* Informacje o systemie/grze */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Status Serwera na żywo */}
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: serverStatus.loading ? 'rgba(255, 255, 255, 0.05)' : (serverStatus.online ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: serverStatus.loading ? 'var(--text-muted)' : (serverStatus.online ? 'var(--color-success)' : '#ef4444')
            }}>
              <Wifi size={22} className={serverStatus.loading ? 'animate-pulse' : ''} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>STATUS SERWERA</span>
              {serverStatus.loading ? (
                <span style={{ fontSize: '16px', fontWeight: '700' }}>Łączenie...</span>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '16px', fontWeight: '700', color: serverStatus.online ? 'var(--color-success)' : '#ef4444' }}>
                    {serverStatus.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                  {serverStatus.online && (
                    <span style={{ fontSize: '12px', fontWeight: '700', background: 'rgba(6, 182, 212, 0.1)', color: 'var(--color-secondary)', padding: '2px 8px', borderRadius: '12px' }}>
                      {serverStatus.players.online} / {serverStatus.players.max}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Wybór Wersji Paczki */}
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px', overflow: 'visible', zIndex: 10 }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
              <DownloadCloud size={22} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '4px' }}>WERSJA PACZKI DO INSTALACJI</span>
              <div style={{ position: 'relative' }}>
                <button 
                  onClick={() => setIsVersionDropdownOpen(!isVersionDropdownOpen)}
                  style={{ 
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(0, 0, 0, 0.2)', 
                    border: '1px solid var(--border-color)', 
                    color: 'white', 
                    padding: '10px 14px', 
                    borderRadius: '8px',
                    fontSize: '14px',
                    outline: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>
                    {config.targetPackVersion === 'latest' || !config.targetPackVersion 
                      ? 'Najnowsza (Zalecane)' 
                      : (packVersions.find(v => v.tag_name === config.targetPackVersion)?.name || config.targetPackVersion)}
                  </span>
                  <ChevronDown size={16} style={{ color: 'var(--text-muted)', transform: isVersionDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                </button>
                
                {isVersionDropdownOpen && (
                  <>
                    <div 
                      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }} 
                      onClick={() => setIsVersionDropdownOpen(false)} 
                    />
                    <div style={{ 
                      position: 'absolute', 
                      top: '100%', 
                      left: 0, 
                      right: 0, 
                      marginTop: '6px',
                      background: '#1a1a24', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '8px',
                      boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                      zIndex: 50,
                      maxHeight: '220px',
                      overflowY: 'auto'
                    }} className="custom-scroll">
                      <div 
                        onClick={() => { onSave({ ...config, targetPackVersion: 'latest' }); setIsVersionDropdownOpen(false); }}
                        style={{ 
                          padding: '10px 14px', 
                          cursor: 'pointer', 
                          fontSize: '14px',
                          background: (config.targetPackVersion === 'latest' || !config.targetPackVersion) ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                          color: (config.targetPackVersion === 'latest' || !config.targetPackVersion) ? '#60a5fa' : 'white',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          fontWeight: (config.targetPackVersion === 'latest' || !config.targetPackVersion) ? '600' : '400',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (config.targetPackVersion !== 'latest' && config.targetPackVersion) {
                            e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = (config.targetPackVersion === 'latest' || !config.targetPackVersion) ? 'rgba(59, 130, 246, 0.15)' : 'transparent';
                        }}
                      >
                        Najnowsza (Zalecane)
                      </div>
                      {packVersions.map(v => (
                        <div 
                          key={v.tag_name}
                          onClick={() => { onSave({ ...config, targetPackVersion: v.tag_name }); setIsVersionDropdownOpen(false); }}
                          style={{ 
                            padding: '10px 14px', 
                            cursor: 'pointer', 
                            fontSize: '14px',
                            background: config.targetPackVersion === v.tag_name ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                            color: config.targetPackVersion === v.tag_name ? '#60a5fa' : 'var(--text-muted)',
                            fontWeight: config.targetPackVersion === v.tag_name ? '600' : '400',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            if (config.targetPackVersion !== v.tag_name) {
                              e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                              e.target.style.color = 'white';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = config.targetPackVersion === v.tag_name ? 'rgba(59, 130, 246, 0.15)' : 'transparent';
                            e.target.style.color = config.targetPackVersion === v.tag_name ? '#60a5fa' : 'var(--text-muted)';
                          }}
                        >
                          {v.name}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(6, 182, 212, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-secondary)' }}>
              <Layers size={22} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>WERSJA GRY</span>
              <span style={{ fontSize: '16px', fontWeight: '700' }}>MC {config.minecraftVersion}</span>
            </div>
          </div>

          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
              <Layers size={22} style={{ transform: 'rotate(90deg)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>ALOKACJA PAMIĘCI</span>
              <span style={{ fontSize: '16px', fontWeight: '700' }}>{(config.ram / 1024).toFixed(1)} GB RAM</span>
            </div>
          </div>

          {/* Szybki dostęp do folderów gry */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Skróty do folderów
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => window.api.openFolder('mods')}
                style={{ height: '36px', padding: '0 8px', gap: '6px', fontSize: '11px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', cursor: 'pointer' }}
                title="Otwórz folder mods z zainstalowanymi modami"
              >
                <FolderOpen size={13} />
                <span>Mody</span>
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => window.api.openFolder('root')}
                style={{ height: '36px', padding: '0 8px', gap: '6px', fontSize: '11px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', cursor: 'pointer' }}
                title="Otwórz główny folder gry"
              >
                <FolderOpen size={13} />
                <span>Folder gry</span>
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => window.api.openFolder('screenshots')}
                style={{ height: '36px', padding: '0 8px', gap: '6px', fontSize: '11px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', gridColumn: 'span 2', borderRadius: '8px', cursor: 'pointer' }}
                title="Otwórz folder zrzutów ekranu"
              >
                <FolderOpen size={13} />
                <span>Zrzuty ekranu</span>
              </button>
            </div>
          </div>

          <button
            className="btn btn-outline"
            onClick={onSync}
            disabled={isWorking}
            style={{ width: '100%', gap: '8px', height: '46px', cursor: 'pointer' }}
          >
            <RefreshCw size={16} />
            Wymuś aktualizację paczki
          </button>
        </div>
      </div>

    </div>
  );
}

export default Dashboard;

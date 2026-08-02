import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, Check, AlertCircle, Loader2 } from 'lucide-react';

function ModrinthBrowser({ config }) {
  const [activeType, setActiveType] = useState('mod'); // 'mod', 'shader', 'resourcepack'
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [installedIds, setInstalledIds] = useState([]);
  const [installingMap, setInstallingMap] = useState({});
  const [message, setMessage] = useState('');

  // Pobranie aktualnie zainstalowanych własnych projektów, aby oznaczyć je jako "zainstalowane"
  const fetchInstalledProjects = useCallback(async () => {
    try {
      const userProjects = await window.api.getUserProjects(activeType);
      setInstalledIds(userProjects.map(p => p.id));
    } catch (e) {
      console.error("Błąd ładowania zainstalowanych projektów:", e);
    }
  }, [activeType]);

  const handleSearch = useCallback(async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const results = await window.api.searchModrinth(query, config.minecraftVersion, activeType);
      setProjects(results);
      if (results.length === 0) {
        setMessage('Nie znaleziono żadnych dodatków spełniających kryteria.');
      }
    } catch (err) {
      setMessage('Wystąpił błąd podczas wyszukiwania.');
    } finally {
      setLoading(false);
    }
  }, [query, config.minecraftVersion, activeType]);

  // Pobieramy i wyszukujemy przy zmianie typu lub na start
  useEffect(() => {
    fetchInstalledProjects();
    handleSearch();
  }, [activeType, fetchInstalledProjects, handleSearch]);

  const handleInstall = async (projectId) => {
    if (installingMap[projectId]) return;
    
    setInstallingMap(prev => ({ ...prev, [projectId]: true }));
    try {
      const result = await window.api.installModrinthProject(projectId, activeType);
      if (result.success) {
        fetchInstalledProjects(); // Odśwież listę zainstalowanych
      } else {
        alert(`Błąd instalacji: ${result.error}`);
      }
    } catch (err) {
      alert(`Wystąpił błąd: ${err.message}`);
    } finally {
      setInstallingMap(prev => ({ ...prev, [projectId]: false }));
    }
  };

  const getHeaderDetails = () => {
    switch (activeType) {
      case 'shader':
        return {
          title: "Wyszukiwarka shaderów Modrinth",
          desc: "Pobieraj paczki shaderów poprawiające oświetlenie, cienie i wodę (wymaga modu graficznego Iris/Sodium zainstalowanego w paczce).",
          placeholder: "Szukaj shaderów (np. Complementary, BSL, Sildurs...)"
        };
      case 'resourcepack':
        return {
          title: "Wyszukiwarka paczek zasobów Modrinth",
          desc: `Pobieraj paczki tekstur (Resource Packs) kompatybilne z wersją Minecraft ${config.minecraftVersion}.`,
          placeholder: "Szukaj paczek zasobów (np. Faithful, Bare Bones, Fresh Animations...)"
        };
      default:
        return {
          title: "Wyszukiwarka modów Modrinth",
          desc: `Dodawaj własne modyfikacje kompatybilne z wersją Minecraft ${config.minecraftVersion} i silnikiem Fabric.`,
          placeholder: "Szukaj modyfikacji (np. Sodium, Iris, AppleSkin, Zoom...)"
        };
    }
  };

  const headerDetails = getHeaderDetails();

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
      
      {/* Header */}
      <div>
        <h2 style={{ fontSize: '24px', fontWeight: '800' }}>{headerDetails.title}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
          {headerDetails.desc}
        </p>
      </div>

      {/* Zakładki wyboru typu dodatku */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
        <button 
          type="button" 
          className={`btn ${activeType === 'mod' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setActiveType('mod'); setQuery(''); }}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          Mody
        </button>
        <button 
          type="button" 
          className={`btn ${activeType === 'shader' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setActiveType('shader'); setQuery(''); }}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          Shadery
        </button>
        <button 
          type="button" 
          className={`btn ${activeType === 'resourcepack' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setActiveType('resourcepack'); setQuery(''); }}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          Paczki Zasobów
        </button>
      </div>

      {/* Wyszukiwarka */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px' }}>
        <div style={{ position: 'relative', flexGrow: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            className="form-input" 
            placeholder={headerDetails.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', paddingLeft: '48px', height: '46px' }}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ height: '46px', gap: '8px' }} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={16} /> : null}
          Szukaj
        </button>
      </form>

      {/* Informacje/Błędy */}
      {message && (
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderColor: 'var(--border-color)', color: 'var(--text-muted)', fontSize: '14px' }}>
          <AlertCircle size={18} />
          {message}
        </div>
      )}

      {/* Siatka projektów */}
      <div style={{ flexGrow: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
            <Loader2 className="animate-spin" size={32} style={{ color: 'var(--color-primary)' }} />
          </div>
        ) : (
          <div className="mod-grid">
            {projects.map(project => {
              const isInstalled = installedIds.includes(project.id);
              const isInMainPack = project.inMainPack;
              const isInstalling = installingMap[project.id];

              let buttonText = (
                <>
                  <Download size={14} />
                  Zainstaluj do gry
                </>
              );
              let btnClass = 'btn btn-primary';

              if (isInstalling) {
                buttonText = (
                  <>
                    <Loader2 className="animate-spin" size={14} />
                    Instalowanie...
                  </>
                );
              } else if (isInMainPack) {
                buttonText = (
                  <>
                    <Check size={14} style={{ color: 'var(--color-success)' }} />
                    W paczce głównej
                  </>
                );
                btnClass = 'btn btn-outline';
              } else if (isInstalled) {
                buttonText = (
                  <>
                    <Check size={14} style={{ color: 'var(--color-success)' }} />
                    Zainstalowany
                  </>
                );
                btnClass = 'btn btn-outline';
              }

              return (
                <div key={project.id} className="glass-card mod-card">
                  <div>
                    <div className="mod-header">
                      <img 
                        src={project.icon_url || 'https://img.icons8.com/color/96/minecraft-logo.png'} 
                        className="mod-icon" 
                        alt={project.title} 
                        onError={(e) => { e.target.src = 'https://img.icons8.com/color/96/minecraft-logo.png'; }}
                      />
                      <div className="mod-meta">
                        <span className="mod-title" title={project.title}>{project.title}</span>
                        <span className="mod-author">Autor: {project.author}</span>
                      </div>
                    </div>
                    <p className="mod-desc">{project.description}</p>
                  </div>

                  <button 
                    className={btnClass} 
                    onClick={() => handleInstall(project.id)}
                    disabled={isInstalled || isInMainPack || isInstalling}
                    style={{ width: '100%', height: '40px', gap: '8px', fontSize: '13px' }}
                  >
                    {buttonText}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

export default ModrinthBrowser;

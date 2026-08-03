import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, FolderHeart, UploadCloud } from 'lucide-react';

function MyMods({ config }) {
  const [activeType, setActiveType] = useState('mod'); // 'mod', 'shader', 'resourcepack'
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const userProjects = await window.api.getUserProjects(activeType);
      setProjects(userProjects);
    } catch (e) {
      console.error("Błąd pobierania projektów użytkownika:", e);
    } finally {
      setLoading(false);
    }
  }, [activeType]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleToggle = async (filename, currentStatus) => {
    const nextStatus = !currentStatus;
    // Optymistyczna aktualizacja UI
    setProjects(prev => prev.map(p => p.filename === filename ? { ...p, enabled: nextStatus } : p));

    try {
      const res = await window.api.toggleProject(filename, nextStatus, activeType);
      if (!res.success) {
        // Cofnij jeśli błąd
        setProjects(prev => prev.map(p => p.filename === filename ? { ...p, enabled: currentStatus } : p));
        alert(`Błąd przełączania: ${res.error}`);
      }
    } catch (err) {
      setProjects(prev => prev.map(p => p.filename === filename ? { ...p, enabled: currentStatus } : p));
      alert(err.message);
    }
  };

  const handleDelete = async (filename, title) => {
    const typeLabel = activeType === 'mod' ? 'modyfikację' : activeType === 'shader' ? 'shader' : 'paczkę zasobów';
    if (!confirm(`Czy na pewno chcesz usunąć ${typeLabel} "${title}"?`)) return;

    try {
      const res = await window.api.deleteProject(filename, activeType);
      if (res.success) {
        setProjects(prev => prev.filter(p => p.filename !== filename));
      } else {
        alert(`Błąd usuwania: ${res.error}`);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  // Obsługa przeciągania plików
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    
    // Walidacja rozszerzeń na podstawie aktywnej zakładki
    const isJar = activeType === 'mod';
    const expectedExt = isJar ? '.jar' : '.zip';
    const filteredFiles = files.filter(f => f.name.toLowerCase().endsWith(expectedExt));

    if (filteredFiles.length === 0) {
      alert(`W tej zakładce możesz dodawać tylko pliki o rozszerzeniu ${expectedExt}!`);
      return;
    }

    setLoading(true);
    let successCount = 0;
    let errors = [];

    for (const file of filteredFiles) {
      const filePath = file.path;
      if (!filePath) continue;

      try {
        const res = await window.api.addLocalProject(filePath, activeType);
        if (res.success) {
          successCount++;
        } else {
          errors.push(`Plik "${file.name}": ${res.error}`);
        }
      } catch (err) {
        errors.push(`Plik "${file.name}": ${err.message}`);
      }
    }

    await fetchProjects(); // Odśwież listę po dodaniu

    if (errors.length > 0) {
      alert(`Dodano pomyślnie ${successCount} plików.\n\nWystąpiły błędy:\n${errors.join('\n')}`);
    }
  };

  const getHeaderDetails = () => {
    switch (activeType) {
      case 'pack-mod':
        return {
          title: "Mody z Paczki Serwerowej (Ciapongi RP)",
          desc: "Oficjalne modyfikacje dołączone do paczki serwerowej Ciapongi RP. Możesz je tu przeglądać i włączać lub wyłączać.",
          emptyTitle: "Brak zainstalowanych modów paczki",
          emptyDesc: "Paczka serwerowa nie została jeszcze w pełni pobrana z GitHub. Uruchom grę na Pulpicie, aby ją pobrać.",
          dragText: "Mody paczki serwerowej",
          dragDesc: "Mody paczki są zarządzane automatycznie."
        };
      case 'pack-resourcepack':
        return {
          title: "Paczki Zasobów z Paczki Serwerowej (Ciapongi RP)",
          desc: "Oficjalne paczki zasobów (tekstury/dźwięki) dołączone do paczki serwerowej Ciapongi RP. Możesz je tu przeglądać oraz włączać lub wyłączać.",
          emptyTitle: "Brak paczek zasobów w paczce serwerowej",
          emptyDesc: "Paczka serwerowa nie posiada dedykowanych dodatkowych paczek zasobów w folderze resourcepacks.",
          dragText: "Paczki zasobów paczki serwerowej",
          dragDesc: "Paczki zasobów paczki są zarządzane automatycznie."
        };
      case 'shader':
        return {
          title: "Moje Własne Shadery",
          desc: "Zarządzaj zainstalowanymi shaderami. Przeciągnij pliki shaderów .zip tutaj lub pobierz nowe z zakładki wyszukiwarki Modrinth.",
          emptyTitle: "Brak własnych shaderów",
          emptyDesc: "Nie dodałeś jeszcze żadnych shaderów. Przeciągnij pliki .zip tutaj lub skorzystaj z wyszukiwarki Modrinth.",
          dragText: "Przeciągnij shadery (.zip) tutaj",
          dragDesc: "Upuść pliki .zip, aby dodać je automatycznie do gry"
        };
      case 'resourcepack':
        return {
          title: "Moje Własne Paczki Zasobów",
          desc: "Zarządzaj zainstalowanymi paczkami zasobów (Resource Packs / Tekstury). Przeciągnij pliki .zip tutaj lub pobierz z Modrinth.",
          emptyTitle: "Brak własnych paczek zasobów",
          emptyDesc: "Nie dodałeś jeszcze żadnych paczek tekstur. Przeciągnij pliki .zip tutaj lub skorzystaj z wyszukiwarki Modrinth.",
          dragText: "Przeciągnij paczki zasobów (.zip) tutaj",
          dragDesc: "Upuść pliki .zip, aby dodać je automatycznie do gry"
        };
      default:
        return {
          title: "Moje Własne Mody",
          desc: "Zarządzaj własnymi modami dodanymi z Modrintha lub przeciągając je tutaj. Pliki te są bezpieczne i nie zostaną usunięte podczas aktualizacji paczki głównej z GitHub.",
          emptyTitle: "Brak własnych modów",
          emptyDesc: "Nie dodałeś jeszcze żadnych dodatkowych modyfikacji. Przeciągnij pliki modów .jar tutaj lub skorzystaj z wyszukiwarki Modrinth.",
          dragText: "Przeciągnij modyfikacje (.jar) tutaj",
          dragDesc: "Upuść pliki .jar, aby dodać je automatycznie do gry"
        };
    }
  };

  const headerDetails = getHeaderDetails();

  return (
    <div 
      className="fade-in" 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '24px', 
        height: '100%',
        position: 'relative'
      }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      
      {/* Header */}
      <div>
        <h2 style={{ fontSize: '24px', fontWeight: '800' }}>{headerDetails.title}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
          {headerDetails.desc}
        </p>
      </div>

      {/* Zakładki wyboru typu zasobów */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', flexWrap: 'wrap' }}>
        <button 
          type="button" 
          className={`btn ${activeType === 'mod' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveType('mod')}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          💜 Własne Mody
        </button>
        <button 
          type="button" 
          className={`btn ${activeType === 'pack-mod' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveType('pack-mod')}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          📦 Mody Paczki Serwerowej
        </button>
        <button 
          type="button" 
          className={`btn ${activeType === 'resourcepack' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveType('resourcepack')}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          🎨 Własne Paczki Zasobów
        </button>
        <button 
          type="button" 
          className={`btn ${activeType === 'pack-resourcepack' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveType('pack-resourcepack')}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          🖼️ Paczki Zasobów z Paczki
        </button>
        <button 
          type="button" 
          className={`btn ${activeType === 'shader' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveType('shader')}
          style={{ height: '36px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}
        >
          🌈 Shadery
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
          <div className="animate-spin" style={{ width: '24px', height: '24px', border: '3px solid var(--border-color)', borderTopColor: 'var(--color-primary)', borderRadius: '50%' }}></div>
        </div>
      ) : projects.length === 0 ? (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '48px', textAlign: 'center', borderColor: 'var(--border-color)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.02)', display: 'flex', alignItems: 'center', justify: 'center', color: 'var(--text-muted)' }}>
            <FolderHeart size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700' }}>{headerDetails.emptyTitle}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px', maxWidth: '300px' }}>
              {headerDetails.emptyDesc}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ flexGrow: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {projects.map(project => (
              <div 
                key={project.id} 
                className="glass-card" 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: '16px 24px',
                  opacity: project.enabled ? 1 : 0.6,
                  transition: 'opacity 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', overflow: 'hidden' }}>
                  <img 
                    src={project.icon_url || 'https://img.icons8.com/color/96/minecraft-logo.png'} 
                    style={{ width: '42px', height: '42px', borderRadius: '8px', border: '1px solid var(--border-color)', objectFit: 'cover' }} 
                    alt={project.title}
                    onError={(e) => { e.target.src = 'https://img.icons8.com/color/96/minecraft-logo.png'; }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{project.title}</span>
                      {activeType.startsWith('pack-') && (
                        <span className="badge badge-violet" style={{ fontSize: '10px', padding: '1px 6px' }}>Paczka Ciapongi RP</span>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Plik: {project.filename}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                  {/* Przełącznik Włącz/Wyłącz */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>
                      {project.enabled ? 'Włączony' : 'Wyłączony'}
                    </span>
                    <label className="switch">
                      <input 
                        type="checkbox" 
                        checked={project.enabled} 
                        onChange={() => handleToggle(project.filename, project.enabled)} 
                      />
                      <span className="slider"></span>
                    </label>
                  </div>

                  {/* Przycisk usuwania (tylko dla własnych modów/shaderów/resourcepacków) */}
                  {!activeType.startsWith('pack-') && (
                    <button 
                      className="btn btn-danger" 
                      onClick={() => handleDelete(project.filename, project.title)}
                      style={{ width: '36px', height: '36px', padding: 0, borderRadius: '8px' }}
                      title="Usuń dodatek"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(10, 10, 15, 0.9)',
            backdropFilter: 'blur(10px)',
            border: '2px dashed var(--color-primary)',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            zIndex: 100,
            pointerEvents: 'none',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <div 
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
              color: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 20px color-mix(in srgb, var(--color-primary) 20%, transparent)'
            }}
          >
            <UploadCloud size={32} className="animate-bounce" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-main)' }}>{headerDetails.dragText}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>{headerDetails.dragDesc}</p>
          </div>
        </div>
      )}

    </div>
  );
}

export default MyMods;

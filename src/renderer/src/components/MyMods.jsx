import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, FolderHeart, UploadCloud, RefreshCw, ArrowUpCircle, CheckCircle2, X, Layers } from 'lucide-react';

function VersionPickerModal({ isOpen, onClose, mod, onSelectVersion, isUpdating }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && mod && mod.projectId) {
      setLoading(true);
      setError(null);
      window.api.getModAvailableVersions(mod.projectId)
        .then(res => {
          if (res.success) {
            setVersions(res.versions || []);
          } else {
            setError(res.error || 'Nie udało się pobrać wydań');
          }
        })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    } else {
      setVersions([]);
    }
  }, [isOpen, mod]);

  if (!isOpen || !mod) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div className="glass-card" style={{
        width: '100%',
        maxWidth: '650px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
        background: '#12121a',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', margin: 0 }}>
              Wybierz wersję modyfikacji: {mod.title}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              Obecnie zainstalowany plik: <code style={{ color: 'var(--color-primary)' }}>{mod.oldFilename}</code>
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            style={{ width: '32px', height: '32px', padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Info Note: Only Stable Releases */}
        <div style={{
          padding: '10px 24px',
          background: 'rgba(59, 130, 246, 0.08)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '12px',
          color: '#60a5fa',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🛡️ Wyświetlane są wyłącznie oficjalne <b>stabilne wydania (Release)</b> dla Minecraft 1.20.1 Fabric (wersje beta i testowe zostały odfiltrowane).</span>
        </div>

        {/* Modal Body / Versions List */}
        <div style={{ padding: '16px 24px', flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '160px' }}>
              <div className="animate-spin" style={{ width: '28px', height: '28px', border: '3px solid var(--border-color)', borderTopColor: 'var(--color-primary)', borderRadius: '50%' }}></div>
            </div>
          ) : error ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-danger)' }}>
              {error}
            </div>
          ) : versions.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Brak innych stabilnych wersji kompatybilnych z Minecraft 1.20.1 Fabric.
            </div>
          ) : (
            versions.map(ver => {
              const isCurrent = mod.oldFilename.toLowerCase() === ver.filename.toLowerCase() ||
                mod.oldFilename.toLowerCase() === (ver.filename + '.disabled').toLowerCase();

              return (
                <div
                  key={ver.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background: isCurrent ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                    border: isCurrent ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid var(--border-color)',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>
                        {ver.versionNumber || ver.name}
                      </span>
                      <span className="badge badge-success" style={{ fontSize: '10px', padding: '1px 6px' }}>
                        Wydanie stabilne
                      </span>
                      {isCurrent && (
                        <span className="badge badge-violet" style={{ fontSize: '10px', padding: '1px 6px' }}>
                          Zainstalowana
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Plik: {ver.filename} {ver.datePublished ? `• ${new Date(ver.datePublished).toLocaleDateString()}` : ''}
                      {ver.size ? ` • ${(ver.size / (1024 * 1024)).toFixed(2)} MB` : ''}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={`btn ${isCurrent ? 'btn-outline' : 'btn-primary'}`}
                    disabled={isCurrent || isUpdating}
                    onClick={() => onSelectVersion(ver)}
                    style={{ height: '32px', padding: '0 14px', fontSize: '12px', whiteSpace: 'nowrap', borderRadius: '8px' }}
                  >
                    {isCurrent ? 'Obecna wersja' : 'Zainstaluj tę wersję'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '12px 24px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          background: 'rgba(255, 255, 255, 0.01)'
        }}>
          <button type="button" className="btn btn-outline" onClick={onClose} style={{ height: '34px', padding: '0 16px', fontSize: '12px', borderRadius: '8px' }}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}

function MyMods({ config }) {
  const [activeType, setActiveType] = useState('mod'); // 'mod', 'shader', 'resourcepack'
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [availableUpdates, setAvailableUpdates] = useState([]);
  const [updatingMap, setUpdatingMap] = useState({});
  const [updateStatusMsg, setUpdateStatusMsg] = useState(null);
  const [versionPickerMod, setVersionPickerMod] = useState(null);

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

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateStatusMsg(null);
    try {
      const res = await window.api.checkModUpdates(activeType);
      if (res.success) {
        setAvailableUpdates(res.updates || []);
        if ((res.updates || []).length === 0) {
          setUpdateStatusMsg('Wszystkie Twoje mody są aktualne (wydania stabilne)! 🎉');
          setTimeout(() => setUpdateStatusMsg(null), 4000);
        }
      } else {
        alert(`Błąd sprawdzania aktualizacji: ${res.error}`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdateSingle = async (upd) => {
    setUpdatingMap(prev => ({ ...prev, [upd.oldFilename]: true }));
    try {
      const res = await window.api.updateMod(upd);
      if (res.success) {
        setAvailableUpdates(prev => prev.filter(u => u.oldFilename !== upd.oldFilename));
        if (versionPickerMod && versionPickerMod.oldFilename === upd.oldFilename) {
          setVersionPickerMod(null);
        }
        setUpdateStatusMsg(`Pomyślnie zaktualizowano modyfikację!`);
        setTimeout(() => setUpdateStatusMsg(null), 4000);
        await fetchProjects();
      } else {
        alert(`Błąd aktualizacji: ${res.error}`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setUpdatingMap(prev => ({ ...prev, [upd.oldFilename]: false }));
    }
  };

  const handleSelectVersionFromPicker = (ver) => {
    if (!versionPickerMod) return;
    handleUpdateSingle({
      oldFilename: versionPickerMod.oldFilename,
      newFilename: ver.filename,
      downloadUrl: ver.downloadUrl
    });
  };

  const handleUpdateAll = async () => {
    if (availableUpdates.length === 0) return;
    const allKeys = {};
    availableUpdates.forEach(u => { allKeys[u.oldFilename] = true; });
    setUpdatingMap(allKeys);
    try {
      const res = await window.api.updateAllMods(availableUpdates);
      if (res.success) {
        setAvailableUpdates([]);
        setUpdateStatusMsg(`Pomyślnie zaktualizowano ${res.updatedCount} modów do wersji stabilnych!`);
        setTimeout(() => setUpdateStatusMsg(null), 4000);
        await fetchProjects();
      } else {
        alert(`Błąd podczas aktualizacji: ${res.error}`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setUpdatingMap({});
    }
  };

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
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
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

        {activeType === 'mod' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
              style={{ height: '36px', padding: '0 14px', fontSize: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} className={checkingUpdates ? 'animate-spin' : ''} />
              {checkingUpdates ? 'Sprawdzanie...' : 'Sprawdź aktualizacje modów'}
            </button>
          </div>
        )}
      </div>

      {/* Komunikat o statusie aktualizacji */}
      {updateStatusMsg && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.12)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          color: '#4ade80',
          borderRadius: '10px',
          padding: '10px 16px',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <CheckCircle2 size={16} />
          <span>{updateStatusMsg}</span>
        </div>
      )}

      {/* Pasek i lista dostępnych aktualizacji wyłącznie dla modów gracza */}
      {availableUpdates.length > 0 && activeType === 'mod' && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(59, 130, 246, 0.12))',
          border: '1px solid rgba(168, 85, 247, 0.35)',
          borderRadius: '14px',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowUpCircle size={22} color="var(--color-primary)" />
              </div>
              <div>
                <span style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>
                  Dostępne aktualizacje Twoich modów ({availableUpdates.length})
                </span>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  Sprawdzono tylko mody dodane przez Ciebie (wykluczono paczkę serwerową). Wyłącznie wersje stabilne (brak wersji beta).
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleUpdateAll}
              disabled={Object.values(updatingMap).some(Boolean)}
              style={{ height: '36px', padding: '0 18px', fontSize: '12px', borderRadius: '8px', fontWeight: '700' }}
            >
              {Object.values(updatingMap).some(Boolean) ? 'Aktualizowanie...' : `Aktualizuj wszystkie do najnowszych (${availableUpdates.length})`}
            </button>
          </div>

          {/* Lista modów, które chcą się zaktualizować */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
            {availableUpdates.map(upd => {
              const isUpdating = updatingMap[upd.oldFilename];
              return (
                <div key={upd.oldFilename} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)' }}>{upd.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({upd.oldFilename})</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>➔</span>
                    <span className="badge badge-success" style={{ fontSize: '11px', padding: '1px 6px' }}>
                      v{upd.newVersion} (Stabilna)
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setVersionPickerMod(upd)}
                      style={{ height: '30px', padding: '0 10px', fontSize: '11px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="Wybierz inną wersję z listy wydań"
                    >
                      <Layers size={13} />
                      Wybierz wersję
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleUpdateSingle(upd)}
                      disabled={isUpdating}
                      style={{ height: '30px', padding: '0 12px', fontSize: '11px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <ArrowUpCircle size={13} className={isUpdating ? 'animate-spin' : ''} />
                      {isUpdating ? 'Pobieranie...' : 'Aktualizuj'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            {projects.map(project => {
              const matchingUpdate = availableUpdates.find(u => {
                const cleanOld = u.oldFilename.replace(/\.disabled$/i, '').toLowerCase();
                const cleanProj = project.filename.replace(/\.disabled$/i, '').toLowerCase();
                return cleanOld === cleanProj;
              });
              const isUpdating = matchingUpdate && updatingMap[matchingUpdate.oldFilename];

              return (
                <div 
                  key={project.id} 
                  className="glass-card" 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    padding: '16px 24px',
                    opacity: project.enabled ? 1 : 0.6,
                    transition: 'opacity 0.2s ease',
                    border: matchingUpdate ? '1px solid rgba(168, 85, 247, 0.4)' : undefined
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
                        {matchingUpdate && (
                          <span className="badge badge-warning" style={{ fontSize: '10px', padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <ArrowUpCircle size={10} /> Nowa stabilna: v{matchingUpdate.newVersion}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Plik: {project.filename}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    {/* Przyciski aktualizacji moda jeśli dostępna */}
                    {matchingUpdate && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => setVersionPickerMod(matchingUpdate)}
                          style={{ height: '34px', padding: '0 10px', fontSize: '11px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title="Wybierz konkretną wersję z listy wydań"
                        >
                          <Layers size={13} />
                          Wybierz wersję
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleUpdateSingle(matchingUpdate)}
                          disabled={isUpdating}
                          style={{ height: '34px', padding: '0 12px', fontSize: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                          title={`Zaktualizuj do ${matchingUpdate.newFilename}`}
                        >
                          <ArrowUpCircle size={14} className={isUpdating ? 'animate-spin' : ''} />
                          {isUpdating ? 'Pobieranie...' : 'Aktualizuj'}
                        </button>
                      </div>
                    )}

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
              );
            })}
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

      {/* Modal wyboru wersji modyfikacji */}
      <VersionPickerModal
        isOpen={!!versionPickerMod}
        onClose={() => setVersionPickerMod(null)}
        mod={versionPickerMod}
        onSelectVersion={handleSelectVersionFromPicker}
        isUpdating={versionPickerMod ? !!updatingMap[versionPickerMod.oldFilename] : false}
      />

    </div>
  );
}

export default MyMods;

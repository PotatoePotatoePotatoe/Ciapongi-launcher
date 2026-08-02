import React, { useState, useEffect, useCallback } from 'react';
import { 
  Trash2, 
  FolderOpen, 
  ChevronLeft, 
  ChevronRight, 
  X, 
  Camera, 
  ExternalLink,
  Calendar,
  HardDrive
} from 'lucide-react';

function Screenshots() {
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const fetchScreenshots = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.getScreenshots();
      setScreenshots(data);
    } catch (e) {
      console.error("Błąd ładowania zrzutów ekranu:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScreenshots();
  }, [fetchScreenshots]);

  const handleDelete = async (filename, e) => {
    if (e) e.stopPropagation();
    if (!confirm(`Czy na pewno chcesz usunąć zrzut ekranu "${filename}"?`)) return;

    try {
      const res = await window.api.deleteScreenshot(filename);
      if (res.success) {
        setScreenshots(prev => prev.filter(s => s.filename !== filename));
        if (lightboxIndex !== null) {
          // Dostosuj indeks lightboxa, jeśli usunięto z poziomu lightboxa
          if (screenshots.length <= 1) {
            setLightboxIndex(null);
          } else if (lightboxIndex >= screenshots.length - 1) {
            setLightboxIndex(screenshots.length - 2);
          }
        }
      } else {
        alert(`Błąd usuwania: ${res.error}`);
      }
    } catch (err) {
      alert(`Wystąpił błąd: ${err.message}`);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await window.api.openFolder('screenshots');
    } catch (e) {
      console.error(e);
    }
  };

  // Obsługa nawigacji w lightboxie
  const handlePrev = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex(prev => (prev === 0 ? screenshots.length - 1 : prev - 1));
  }, [lightboxIndex, screenshots.length]);

  const handleNext = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex(prev => (prev === screenshots.length - 1 ? 0 : prev + 1));
  }, [lightboxIndex, screenshots.length]);

  const handleKeyDown = useCallback((e) => {
    if (lightboxIndex === null) return;
    if (e.key === 'Escape') setLightboxIndex(null);
    if (e.key === 'ArrowLeft') handlePrev();
    if (e.key === 'ArrowRight') handleNext();
  }, [lightboxIndex, handlePrev, handleNext]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const formatDate = (timestamp) => {
    const d = new Date(timestamp);
    return d.toLocaleString('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatSize = (bytes) => {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%', position: 'relative' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: '800' }}>Galeria Zrzutów Ekranu</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
            Przeglądaj, usuwaj i zarządzaj zdjęciami wykonanymi w grze za pomocą klawisza F2.
          </p>
        </div>

        <button 
          className="btn btn-outline" 
          onClick={handleOpenFolder}
          style={{ height: '42px', gap: '8px', display: 'flex', alignItems: 'center' }}
        >
          <FolderOpen size={16} />
          <span>Otwórz folder zrzutów</span>
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
          <div className="animate-spin" style={{ width: '24px', height: '24px', border: '3px solid var(--border-color)', borderTopColor: 'var(--color-primary)', borderRadius: '50%' }}></div>
        </div>
      ) : screenshots.length === 0 ? (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '48px', textAlign: 'center', borderColor: 'var(--border-color)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.02)', display: 'flex', alignItems: 'center', justify: 'center', color: 'var(--text-muted)' }}>
            <Camera size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700' }}>Brak zrzutów ekranu</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px', maxWidth: '300px' }}>
              Nie wykonałeś jeszcze żadnych zdjęć w grze. Użyj klawisza <strong>F2</strong> podczas rozgrywki, aby uwiecznić chwilę.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '6px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
            {screenshots.map((s, index) => (
              <div 
                key={s.filename} 
                className="glass-card" 
                onClick={() => setLightboxIndex(index)}
                style={{ 
                  padding: 0, 
                  overflow: 'hidden', 
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '210px',
                  transition: 'transform 0.25s ease, border-color 0.25s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.borderColor = 'var(--color-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                {/* Obrazek z nakładką */}
                <div style={{ position: 'relative', width: '100%', height: '140px', overflow: 'hidden', background: '#050508' }}>
                  <img 
                    src={s.url} 
                    alt={s.filename} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
                    onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
                  />
                  
                  {/* Szybki przycisk usuwania w rogu */}
                  <button 
                    onClick={(e) => handleDelete(s.filename, e)}
                    style={{ 
                      position: 'absolute', 
                      top: '8px', 
                      right: '8px', 
                      width: '28px', 
                      height: '28px', 
                      borderRadius: '6px', 
                      background: 'rgba(239, 68, 68, 0.9)', 
                      border: 'none', 
                      color: 'white', 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      opacity: 0.9,
                      transition: 'transform 0.2s, background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'scale(1.1)';
                      e.target.style.backgroundColor = '#ef4444';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'scale(1)';
                      e.target.style.backgroundColor = 'rgba(239, 68, 68, 0.9)';
                    }}
                    title="Usuń plik"
                  >
                    <Trash2 size={13} style={{ pointerEvents: 'none' }} />
                  </button>
                </div>

                {/* Footer ze statystykami */}
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', justify: 'center', gap: '2px', background: 'rgba(20, 20, 30, 0.3)' }}>
                  <span style={{ 
                    fontSize: '11px', 
                    color: 'var(--text-main)', 
                    fontWeight: '700', 
                    whiteSpace: 'nowrap', 
                    textOverflow: 'ellipsis', 
                    overflow: 'hidden' 
                  }} title={s.filename}>
                    {s.filename}
                  </span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', fontWeight: '500' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={10} />
                      {formatDate(s.created)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <HardDrive size={10} />
                      {formatSize(s.size)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxIndex !== null && screenshots[lightboxIndex] && (
        <div 
          onClick={() => setLightboxIndex(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(5, 5, 8, 0.95)',
            backdropFilter: 'blur(15px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            animation: 'fadeIn 0.25s ease-out'
          }}
        >
          {/* Obrazek i kontrolki */}
          <div 
            onClick={(e) => e.stopPropagation()} 
            style={{ 
              position: 'relative', 
              maxWidth: '90%', 
              maxHeight: '85%', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center' 
            }}
          >
            <img 
              src={screenshots[lightboxIndex].url} 
              alt="Fullscreen screenshot" 
              style={{ 
                maxWidth: '100%', 
                maxHeight: '75vh', 
                borderRadius: '12px', 
                border: '1px solid var(--border-color)',
                boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
                objectFit: 'contain'
              }} 
            />

            {/* Footer Lightboxa z informacjami i akcjami */}
            <div style={{ 
              display: 'flex', 
              width: '100%', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginTop: '16px',
              background: 'rgba(20, 20, 30, 0.6)',
              padding: '12px 20px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              color: 'white'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '13px', fontWeight: '700' }}>{screenshots[lightboxIndex].filename}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Zrobiono: {formatDate(screenshots[lightboxIndex].created)} | Rozmiar: {formatSize(screenshots[lightboxIndex].size)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  className="btn btn-outline" 
                  onClick={() => window.api.openLogs()} // or standard shell open
                  style={{ 
                    height: '36px', 
                    padding: '0 12px', 
                    fontSize: '12px',
                    borderColor: 'rgba(255,255,255,0.1)',
                    display: 'none' // will keep it clean
                  }}
                >
                  <ExternalLink size={14} />
                  <span>Wyświetl na dysku</span>
                </button>
                <button 
                  className="btn btn-danger" 
                  onClick={() => handleDelete(screenshots[lightboxIndex].filename)}
                  style={{ height: '36px', padding: '0 16px', fontSize: '12px', gap: '6px', borderRadius: '8px' }}
                >
                  <Trash2 size={14} />
                  <span>Usuń z dysku</span>
                </button>
              </div>
            </div>
          </div>

          {/* Przycisk zamknięcia */}
          <button 
            onClick={() => setLightboxIndex(null)}
            style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.03)'}
          >
            <X size={20} />
          </button>

          {/* Strzałka w lewo */}
          <button 
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            style={{
              position: 'absolute',
              left: '24px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.03)'}
          >
            <ChevronLeft size={24} />
          </button>

          {/* Strzałka w prawo */}
          <button 
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            style={{
              position: 'absolute',
              right: '24px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.03)'}
          >
            <ChevronRight size={24} />
          </button>
        </div>
      )}
    </div>
  );
}

export default Screenshots;

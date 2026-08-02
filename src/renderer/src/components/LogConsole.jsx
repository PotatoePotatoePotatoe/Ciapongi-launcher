import React, { useEffect, useRef, useState } from 'react';
import { X, Trash2, ArrowDownCircle, FolderOpen } from 'lucide-react';

function LogConsole({ isOpen, onClose, logs }) {
  const logEndRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Autoscroll przy nadejściu logów
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  return (
    <div className={`console-panel ${isOpen ? 'open' : ''}`}>
      
      {/* Nagłówek konsoli */}
      <div className="console-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }}></span>
          Konsola logów gry Minecraft
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          
          {/* Open log file button */}
          <button 
            onClick={async () => {
              try {
                await window.api.openLogs();
              } catch (e) {
                console.error(e);
              }
            }}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-muted)', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: '600'
            }}
            title="Otwórz plik logów w notatniku/edytorze"
          >
            <FolderOpen size={14} />
            Otwórz plik logów
          </button>

          {/* Autoscroll lock button */}
          <button 
            onClick={() => setAutoScroll(!autoScroll)}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: autoScroll ? 'var(--color-secondary)' : 'var(--text-muted)', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: '600'
            }}
            title="Włącz/wyłącz automatyczne przewijanie w dół"
          >
            <ArrowDownCircle size={14} />
            Autoscroll: {autoScroll ? 'WŁ' : 'WYŁ'}
          </button>

          {/* Zamknięcie konsoli */}
          <button 
            onClick={onClose} 
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Kontener logów */}
      <div className="console-logs custom-scroll">
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px' }}>
            Konsola jest pusta. Uruchom grę, aby zobaczyć logi...
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={{ marginBottom: '2px' }}>
              {log}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

    </div>
  );
}

export default LogConsole;

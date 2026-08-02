import React, { useEffect, useRef } from 'react';
import { UserCheck, UserPlus, ChevronRight, ShieldCheck, User, Trash2 } from 'lucide-react';

function AccountSwitcherPanel({ config, onSwitch, onRemove, onAddOffline, onAddMicrosoft, onClose }) {
  const panelRef = useRef(null);

  // Zamknij panel klikajac poza nim
  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const accounts = config.accounts || [];
  const activeIdx = config.activeAccountIndex ?? 0;

  return (
    <div
      ref={panelRef}
      className="fade-in"
      style={{
        position: 'absolute',
        bottom: '70px',
        left: '12px',
        right: '12px',
        background: 'var(--color-sidebar-bg)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '14px',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
        zIndex: 500,
        overflow: 'hidden',
      }}
    >
      {/* Naglowek */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Konta graczy
        </span>
      </div>

      {/* Lista kont */}
      <div style={{ maxHeight: '220px', overflowY: 'auto', padding: '6px' }} className="custom-scroll">
        {accounts.length === 0 && (
          <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
            Brak kont
          </div>
        )}
        {accounts.map((acc, idx) => {
          const isActive = idx === activeIdx;
          return (
            <button
              key={acc.id || idx}
              onClick={() => { if (!isActive) onSwitch(idx); onClose(); }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '10px',
                background: isActive ? 'var(--color-primary-glow)' : 'transparent',
                border: isActive ? '1px solid rgba(255,255,255,0.10)' : '1px solid transparent',
                cursor: isActive ? 'default' : 'pointer',
                transition: 'background 0.15s',
                textAlign: 'left',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              {/* Avatar */}
              <div style={{
                width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
                background: acc.type === 'microsoft'
                  ? 'var(--gradient-primary)'
                  : 'linear-gradient(135deg, #6b7280, #374151)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: '700', fontSize: '15px', color: '#fff'
              }}>
                {acc.nickname ? acc.nickname[0].toUpperCase() : '?'}
              </div>

              {/* Dane konta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {acc.nickname}
                </div>
                <div style={{ fontSize: '11px', color: acc.type === 'microsoft' ? 'var(--color-secondary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {acc.type === 'microsoft' ? <ShieldCheck size={10} /> : <User size={10} />}
                  {acc.type === 'microsoft' ? 'Premium' : 'Offline'}
                </div>
              </div>

              {/* Aktywne */}
              {isActive && (
                <UserCheck size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
              )}
              
              {/* Przycisk usuwania */}
              <div 
                onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                style={{ 
                  padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                title="Usuń konto"
              >
                <Trash2 size={14} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Przyciski dodawania kont */}
      <div style={{ padding: '6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={() => { onAddMicrosoft(); onClose(); }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', borderRadius: '8px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--color-secondary)', fontSize: '12px', fontWeight: '600',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-secondary-glow)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <ShieldCheck size={14} />
          Dodaj konto Premium (Microsoft)
          <ChevronRight size={12} style={{ marginLeft: 'auto' }} />
        </button>
        <button
          onClick={() => { onAddOffline(); onClose(); }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', borderRadius: '8px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <UserPlus size={14} />
          Dodaj konto Offline (nick)
          <ChevronRight size={12} style={{ marginLeft: 'auto' }} />
        </button>
      </div>
    </div>
  );
}

export default AccountSwitcherPanel;

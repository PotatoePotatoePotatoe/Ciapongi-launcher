import React, { useState } from 'react';
import { X, AlertCircle, UserPlus } from 'lucide-react';

function AddOfflineAccountModal({ onConfirm, onClose }) {
  const [nick, setNick] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = nick.trim();
    if (!trimmed) { setError('Nick nie moze byc pusty.'); return; }
    if (trimmed.length < 3 || trimmed.length > 16) { setError('Nick musi miec od 3 do 16 znakow.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) { setError('Tylko litery, cyfry i podkreslenie (_).'); return; }
    onConfirm(trimmed);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div className="glass-card fade-in" style={{
        width: '100%', maxWidth: '360px', padding: '28px', borderRadius: '18px',
        border: '1px solid rgba(255,255,255,0.08)', position: 'relative'
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '14px', right: '14px',
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', padding: '4px', borderRadius: '6px'
        }}>
          <X size={16} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <UserPlus size={22} style={{ color: 'var(--color-secondary)' }} />
          <h3 style={{ fontSize: '17px', fontWeight: '700', margin: 0 }}>Nowe konto Offline</h3>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Nick gracza</label>
            <input
              type="text"
              className="form-input"
              value={nick}
              onChange={e => { setNick(e.target.value); setError(''); }}
              placeholder="Np. Gracz_123"
              style={{ height: '44px' }}
              autoFocus
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              3–16 znakow, tylko litery, cyfry i _
            </span>
          </div>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontSize: '12px', fontWeight: '600' }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button type="button" onClick={onClose} className="btn btn-outline" style={{ flex: 1, height: '40px' }}>Anuluj</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1, height: '40px' }}>Dodaj konto</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddOfflineAccountModal;

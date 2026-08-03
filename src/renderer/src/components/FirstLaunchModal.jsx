import React, { useState } from 'react';
import { User, Key, ArrowLeft, RefreshCw, AlertCircle, ShieldCheck, Gamepad2 } from 'lucide-react';

function FirstLaunchModal({ config, onComplete }) {
  const [screen, setScreen] = useState('choice'); // 'choice', 'offline', 'microsoft-loading'
  const [nickname, setNickname] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [validationError, setValidationError] = useState('');

  const handleChooseOffline = () => {
    setScreen('offline');
    setValidationError('');
  };

  const handleOfflineSave = async (e) => {
    e.preventDefault();
    const trimmedNick = nickname.trim();
    if (!trimmedNick) {
      setValidationError('Nazwa gracza nie może być pusta.');
      return;
    }
    if (trimmedNick.length < 3 || trimmedNick.length > 16) {
      setValidationError('Nazwa gracza musi mieć od 3 do 16 znaków.');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedNick)) {
      setValidationError('Nazwa gracza może zawierać tylko litery, cyfry i znak podkreślenia (_).');
      return;
    }

    const updatedConfig = {
      ...config,
      loginType: 'offline',
      nickname: trimmedNick,
      microsoftAuth: null
    };

    await window.api.saveConfig(updatedConfig);
    onComplete(updatedConfig);
  };

  const handleMicrosoftLogin = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    setScreen('microsoft-loading');
    try {
      const res = await window.api.loginMicrosoft();
      if (res.success) {
        const newConfig = await window.api.getConfig();
        onComplete(newConfig);
      } else {
        setLoginError(res.error || 'Błąd logowania Microsoft.');
        setScreen('choice');
      }
    } catch (err) {
      setLoginError(err.message);
      setScreen('choice');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div className="glass-card fade-in" style={styles.card}>
        {/* Decorative background glow */}
        <div style={styles.glowOrb}></div>

        {screen === 'choice' && (
          <div style={styles.content}>
            <div style={styles.header}>
              <Gamepad2 size={48} style={{ color: 'var(--color-secondary)', marginBottom: '8px' }} />
              <h2 style={styles.title}>Witaj w Ciapongi-RP!</h2>
              <p style={styles.subtitle}>
                Skonfigurowaliśmy już ustawienia launchera i zoptymalizowaliśmy parametry Javy pod Twój komputer. Wybierz jak chcesz się logować:
              </p>
            </div>

            {loginError && (
              <div style={styles.errorBanner}>
                <AlertCircle size={18} />
                <span>{loginError}</span>
              </div>
            )}

            <div style={styles.optionsContainer}>
              {/* Microsoft Account Card */}
              <div 
                style={styles.optionCard}
                onClick={handleMicrosoftLogin}
                className="option-hover-card"
              >
                <div style={{ ...styles.iconContainer, background: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)' }}>
                  <ShieldCheck size={24} />
                </div>
                <div style={styles.optionTextContainer}>
                  <h4 style={styles.optionTitle}>Konto Premium (Microsoft)</h4>
                  <p style={styles.optionDesc}>
                    Logowanie przez oficjalne serwery Mojang/Microsoft. Dostęp do skinów premium, pelerynek oraz serwerów z weryfikacją konta.
                  </p>
                </div>
              </div>

              {/* Offline Account Card */}
              <div 
                style={styles.optionCard}
                onClick={handleChooseOffline}
                className="option-hover-card"
              >
                <div style={{ ...styles.iconContainer, background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', color: 'var(--color-primary)' }}>
                  <User size={24} />
                </div>
                <div style={styles.optionTextContainer}>
                  <h4 style={styles.optionTitle}>Konto Offline (Non-Premium)</h4>
                  <p style={styles.optionDesc}>
                    Logowanie bez hasła za pomocą własnej nazwy użytkownika. Szybki start bez konieczności łączenia konta Microsoft.
                  </p>
                </div>
              </div>
            </div>

            <div style={styles.footerInfo}>
              Logowanie Premium odbywa się bezpiecznie w osobnym oknie bezpośrednio przez serwery Microsoft.
            </div>
          </div>
        )}

        {screen === 'offline' && (
          <div style={styles.content}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <button 
                onClick={() => setScreen('choice')}
                style={styles.backButton}
                title="Wróć"
              >
                <ArrowLeft size={18} />
              </button>
              <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>Konfiguracja konta Offline</h3>
            </div>

            <form onSubmit={handleOfflineSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Twój pseudonim w grze (Nick)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setValidationError('');
                  }}
                  placeholder="Wpisz swój nick (np. Gracz_123)"
                  style={{ height: '46px' }}
                  autoFocus
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Nick musi mieć od 3 do 16 znaków. Dozwolone są litery, cyfry oraz znak podkreślenia.
                </span>
              </div>

              {validationError && (
                <div style={styles.errorBanner}>
                  <AlertCircle size={16} />
                  <span>{validationError}</span>
                </div>
              )}

              <button 
                type="submit" 
                className="btn btn-primary"
                style={{ height: '48px', marginTop: '8px', fontWeight: '700' }}
              >
                Zapisz i kontynuuj
              </button>
            </form>
          </div>
        )}

        {screen === 'microsoft-loading' && (
          <div style={{ ...styles.content, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <RefreshCw className="animate-spin" size={48} style={{ color: 'var(--color-secondary)', marginBottom: '24px' }} />
            <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Logowanie Microsoft</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '380px', lineHeight: '1.5' }}>
              W nowym oknie otworzyła się bezpieczna strona logowania Microsoft Live. Zaloguj się na swoje konto z Minecraftem, aby przejść dalej.
            </p>
            <button 
              className="btn btn-outline"
              onClick={() => {
                setIsLoggingIn(false);
                setScreen('choice');
              }}
              style={{ marginTop: '24px', height: '40px', padding: '0 20px' }}
            >
              Anuluj
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(5, 5, 8, 0.88)',
    backdropFilter: 'blur(25px)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    padding: '36px',
    borderRadius: '24px',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    position: 'relative',
    overflow: 'hidden',
  },
  glowOrb: {
    position: 'absolute',
    top: '-30%',
    left: '-30%',
    width: '160%',
    height: '160%',
    background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 5%, transparent) 0%, transparent 60%)',
    zIndex: 0,
    pointerEvents: 'none',
  },
  content: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  header: {
    textAlign: 'center',
    marginBottom: '28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  title: {
    fontSize: '24px',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    margin: '4px 0 8px 0',
  },
  subtitle: {
    color: 'var(--text-muted)',
    fontSize: '13px',
    lineHeight: '1.6',
    textAlign: 'center',
    maxWidth: '440px',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--color-danger)',
    padding: '12px 16px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    marginBottom: '20px',
  },
  optionsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  optionCard: {
    display: 'flex',
    gap: '16px',
    padding: '18px',
    borderRadius: '16px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  iconContainer: {
    width: '46px',
    height: '46px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  optionTextContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  optionTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: 'var(--text-main)',
  },
  optionDesc: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    lineHeight: '1.45',
  },
  backButton: {
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.2s',
    border: '1px solid var(--border-color)',
  },
  footerInfo: {
    marginTop: '28px',
    fontSize: '11px',
    color: 'var(--text-muted)',
    textAlign: 'center',
    lineHeight: '1.4',
  }
};

export default FirstLaunchModal;

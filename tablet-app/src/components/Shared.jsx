import React, { useState, useEffect } from 'react';
import { X, Lock } from 'lucide-react';
import { C } from '../theme';
import { verifyPin, verifyManagerPin, setCurrentStaff } from '../services/staffStorage';
import { logActivity } from '../services/activityStorage';
import brandIcon from '../assets/brand-icon.png';

// =====================================================================
// BRAND MARK — the Vido Food icon (replaces the old "F" letter badge)
// =====================================================================
export function BrandMark({ size = 64, radius, style }) {
  return (
    <img
      src={brandIcon}
      alt="Vido Food"
      style={{
        width: size, height: size,
        borderRadius: radius != null ? radius : size * 0.28,
        objectFit: 'contain',
        display: 'block',
        ...style,
      }}
    />
  );
}

// =====================================================================
// AVATAR — staff profile picture. Supports image (data/URL), an emoji,
// or falls back to initials on a deterministic color. Manager gets the
// brand gradient so the role reads at a glance.
// =====================================================================
const AVATAR_COLORS = [
  'linear-gradient(135deg,#60A5FA,#2563EB)',
  'linear-gradient(135deg,#34D399,#059669)',
  'linear-gradient(135deg,#F472B6,#DB2777)',
  'linear-gradient(135deg,#A78BFA,#7C3AED)',
  'linear-gradient(135deg,#22D3EE,#0891B2)',
  'linear-gradient(135deg,#FB923C,#EA580C)',
];
function colorFromName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initialsOf(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

export function Avatar({ staff, size = 40, style }) {
  const name = staff?.name || '?';
  const av = staff?.avatar || '';
  const isImg = /^(data:|https?:|\/)/.test(av);
  const isEmoji = av && !isImg;
  const isManager = staff?.role === 'manager';
  const base = {
    width: size, height: size, borderRadius: size * 0.32,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    ...style,
  };
  if (isImg) {
    return <img src={av} alt={name} style={{ ...base, objectFit: 'cover' }} />;
  }
  return (
    <div style={{
      ...base,
      background: isManager ? C.primaryG : colorFromName(name),
      color: isManager ? C.bg : '#fff',
      fontWeight: 900, fontSize: size * (isEmoji ? 0.5 : 0.4),
    }}>
      {isEmoji ? av : initialsOf(name)}
    </div>
  );
}

// =====================================================================
// MODAL WRAPPER
// =====================================================================
export function Modal({ onClose, children, maxWidth = 540 }) {
  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={{ ...mStyles.body, maxWidth }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ModalClose({ onClose }) {
  return (
    <button onClick={onClose} style={mStyles.close} aria-label="Close">
      <X size={18} />
    </button>
  );
}

const mStyles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: C.overlay,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  },
  body: {
    background: C.panel,
    borderRadius: 18,
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    position: 'relative',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  close: {
    position: 'absolute', top: 14, right: 14,
    width: 34, height: 34,
    background: C.card, color: C.text,
    border: 'none', borderRadius: 999,
    cursor: 'pointer', zIndex: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
};

// =====================================================================
// PIN LOCK
// =====================================================================
export function PinLockScreen({ title, subtitle, managerOnly = false, fullScreen = true, onUnlock, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pin.length === 4) {
      submit();
    }
    // eslint-disable-next-line
  }, [pin]);

  const press = (d) => {
    if (busy) return;
    setError('');
    if (pin.length < 4) setPin(pin + d);
  };
  const backspace = () => { setError(''); setPin(pin.slice(0, -1)); };

  const submit = async () => {
    if (pin.length < 4) return;
    setBusy(true);
    setError('');
    try {
      const staff = managerOnly ? await verifyManagerPin(pin) : await verifyPin(pin);
      if (staff) {
        if (!managerOnly) {
          setCurrentStaff(staff);
          logActivity('login', `Signed in as ${staff.role}`, { staff });
        }
        onUnlock(staff);
      } else {
        setError(managerOnly ? 'Manager PIN required' : 'Invalid PIN');
        setPin('');
      }
    } catch (e) {
      setError(e.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const card = (
    <div style={pStyles.card}>
      <div style={pStyles.gloss} />
      <BrandMark size={76} style={{ margin: '0 auto 18px', filter: 'drop-shadow(0 6px 18px rgba(255,150,0,0.45))' }} />
      <div style={pStyles.title}>{title || 'Enter PIN'}</div>
      <div style={pStyles.subtitle}>{subtitle || 'Sign in to continue'}</div>
      <div style={pStyles.dots}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            ...pStyles.dot,
            background: i < pin.length ? C.primary : 'rgba(255,255,255,0.14)',
            boxShadow: i < pin.length ? '0 0 12px rgba(255,204,0,0.7)' : 'none',
            transform: i < pin.length ? 'scale(1.1)' : 'scale(1)',
          }} />
        ))}
      </div>
      {error && <div style={pStyles.error}>{error}</div>}
      <div style={pStyles.pad}>
        {[1,2,3,4,5,6,7,8,9].map(d => (
          <button key={d} onClick={() => press(d)} className="glass-key" style={pStyles.key}>{d}</button>
        ))}
        {onCancel ? (
          <button onClick={onCancel} className="glass-key" style={{ ...pStyles.key, color: '#FF8A8A', fontSize: 13 }}>Cancel</button>
        ) : <div />}
        <button onClick={() => press(0)} className="glass-key" style={pStyles.key}>0</button>
        <button onClick={backspace} className="glass-key" style={{ ...pStyles.key, fontSize: 20 }}>⌫</button>
      </div>
      {!managerOnly && fullScreen && (
        <div style={pStyles.hint}>Default Manager: 1234 · Cashier: 0000</div>
      )}
    </div>
  );

  return (
    <div style={fullScreen ? pStyles.overlay : pStyles.overlayModal}>
      <style>{GLASS_CSS}</style>
      <div style={{ ...pStyles.blob, ...pStyles.blobA }} />
      <div style={{ ...pStyles.blob, ...pStyles.blobB }} />
      <div style={{ ...pStyles.blob, ...pStyles.blobC }} />
      {card}
    </div>
  );
}

const GLASS_CSS = `
  @keyframes vidoFloat {
    0%,100% { transform: translate(0,0) scale(1); }
    50%     { transform: translate(20px,-26px) scale(1.12); }
  }
  .glass-key {
    -webkit-backdrop-filter: blur(14px) saturate(160%);
    backdrop-filter: blur(14px) saturate(160%);
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 4px 14px rgba(0,0,0,0.18);
    transition: transform .08s ease, background .15s ease;
  }
  .glass-key:hover  { background: rgba(255,255,255,0.15); }
  .glass-key:active { transform: scale(0.93); background: rgba(255,255,255,0.24); }
`;

const pStyles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 2000, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(120% 120% at 50% 0%, #1a1f2e 0%, #0b0d14 55%, #07080d 100%)',
  },
  overlayModal: {
    position: 'fixed', inset: 0, zIndex: 2000, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(7,8,13,0.72)',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  },
  blob: {
    position: 'absolute', borderRadius: '50%', filter: 'blur(70px)',
    opacity: 0.55, pointerEvents: 'none', animation: 'vidoFloat 14s ease-in-out infinite',
  },
  blobA: { width: 360, height: 360, top: '-8%', left: '8%', background: '#FF9500' },
  blobB: { width: 320, height: 320, bottom: '2%', right: '6%', background: '#FFCC00', animationDelay: '-5s' },
  blobC: { width: 260, height: 260, top: '40%', left: '46%', background: '#FF5DA2', opacity: 0.35, animationDelay: '-9s' },
  card: {
    position: 'relative', zIndex: 1,
    width: 360, padding: '34px 38px', borderRadius: 28,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.16)',
    backdropFilter: 'blur(34px) saturate(160%)',
    WebkitBackdropFilter: 'blur(34px) saturate(160%)',
    boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.30)',
    overflow: 'hidden',
  },
  gloss: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '45%',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0))',
    pointerEvents: 'none',
  },
  title: { textAlign: 'center', fontSize: 23, fontWeight: 900, color: '#fff', marginBottom: 4, position: 'relative' },
  subtitle: { textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 24 },
  dots: { display: 'flex', gap: 14, justifyContent: 'center', margin: '0 0 18px' },
  dot: { width: 15, height: 15, borderRadius: 999, transition: 'all 0.18s ease' },
  error: {
    background: 'rgba(239,68,68,0.18)', color: '#FFB4B4',
    border: '1px solid rgba(239,68,68,0.35)',
    padding: '8px 12px', borderRadius: 10,
    textAlign: 'center', fontWeight: 800, fontSize: 12,
    marginBottom: 14,
  },
  pad: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 },
  key: {
    height: 58, color: '#fff',
    borderRadius: 16, cursor: 'pointer',
    fontSize: 22, fontWeight: 800, fontFamily: 'inherit',
  },
  hint: {
    textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.4)',
    fontWeight: 700, marginTop: 18, fontStyle: 'italic',
  },
};

// =====================================================================
// SHARED BUTTONS
// =====================================================================
export function Button({ variant = 'primary', size = 'md', children, style, ...props }) {
  const sizes = {
    sm: { padding: '6px 12px', fontSize: 12 },
    md: { padding: '10px 16px', fontSize: 13 },
    lg: { padding: '14px 22px', fontSize: 15 },
  };
  const variants = {
    primary: {
      background: C.primary, color: C.bg,
      boxShadow: `0 3px 0 ${C.primaryD}`,
    },
    secondary: { background: C.card, color: C.text },
    danger: { background: C.red, color: '#fff' },
    ghost: { background: 'transparent', color: C.text, border: `1px solid ${C.border}` },
  };
  return (
    <button
      style={{
        border: 'none', borderRadius: 10, cursor: 'pointer',
        fontWeight: 800, fontFamily: 'inherit',
        ...sizes[size], ...variants[variant], ...style,
      }}
      {...props}
    >{children}</button>
  );
}

export function Input({ style, ...props }) {
  return (
    <input
      style={{
        width: '100%', padding: '10px 14px',
        background: C.card, color: C.text,
        border: `1px solid ${C.border}`,
        borderRadius: 10, fontSize: 14, fontWeight: 700,
        fontFamily: 'inherit', outline: 'none',
        ...style,
      }}
      {...props}
    />
  );
}

export function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textMute, fontWeight: 700, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

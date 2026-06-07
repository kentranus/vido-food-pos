/**
 * theme.js — Vido Food brand colors (#FFCC00 yellow)
 * Dark + Light mode via CSS variables. Dark is default.
 */

export const THEMES = {
  dark: {
    '--bg':        '#0F1419',
    '--panel':     '#1A1F26',
    '--card':      '#252A33',
    '--cardHover': '#2D333D',
    '--border':    '#374151',
    '--text':      '#FFFFFF',
    '--textMute':  '#9CA3AF',
    '--textDim':   '#6B7280',
    // Food brand colors — #FFCC00
    '--primary':   '#FFCC00',
    '--primaryD':  '#E0B000',  // Darker shade for shadows
    '--primaryA':  'rgba(255,204,0,0.18)',
    '--accent':    '#FFE066',  // Lighter for gradients
    '--primaryG':  'linear-gradient(135deg, #FFE066 0%, #FFCC00 45%, #FF9500 100%)',
    '--primaryGShadow': '0 4px 16px rgba(255,165,0,0.45)',
    '--yellow':    '#FCD34D',
    '--red':       '#EF4444',
    '--redA':      'rgba(239,68,68,0.15)',
    '--blue':      '#3B82F6',
    '--cyan':      '#2DD4BF',
    '--cyanD':     '#14A89A',
    '--green':     '#4ADE80',
    '--shadow':    'rgba(0,0,0,0.4)',
    '--overlay':   'rgba(0,0,0,0.7)',
  },
  light: {
    '--bg':        '#F5F5F5',
    '--panel':     '#FFFFFF',
    '--card':      '#F3F4F6',
    '--cardHover': '#E5E7EB',
    '--border':    '#D1D5DB',
    '--text':      '#111827',
    '--textMute':  '#4B5563',
    '--textDim':   '#9CA3AF',
    '--primary':   '#FFCC00',
    '--primaryD':  '#E0B000',
    '--primaryA':  'rgba(255,204,0,0.20)',
    '--accent':    '#FFE066',
    '--primaryG':  'linear-gradient(135deg, #FFE066 0%, #FFCC00 45%, #FF9500 100%)',
    '--primaryGShadow': '0 4px 16px rgba(255,165,0,0.35)',
    '--yellow':    '#EAB308',
    '--red':       '#DC2626',
    '--redA':      'rgba(220,38,38,0.10)',
    '--blue':      '#2563EB',
    '--cyan':      '#0891B2',
    '--cyanD':     '#0E7490',
    '--green':     '#16A34A',
    '--shadow':    'rgba(0,0,0,0.10)',
    '--overlay':   'rgba(0,0,0,0.5)',
  },
};

export function applyTheme(mode) {
  const theme = THEMES[mode] || THEMES.dark;
  Object.entries(theme).forEach(([k, v]) => {
    document.documentElement.style.setProperty(k, v);
  });
  try { localStorage.setItem('vido_theme', mode); } catch {}
  document.documentElement.setAttribute('data-theme', mode);
}

export function getInitialTheme() {
  try { return localStorage.getItem('vido_theme') || 'dark'; } catch { return 'dark'; }
}

export const C = {
  bg:        'var(--bg)',
  panel:     'var(--panel)',
  card:      'var(--card)',
  cardHover: 'var(--cardHover)',
  border:    'var(--border)',
  text:      'var(--text)',
  textMute:  'var(--textMute)',
  textDim:   'var(--textDim)',
  primary:   'var(--primary)',
  primaryD:  'var(--primaryD)',
  primaryA:  'var(--primaryA)',
  primaryG:  'var(--primaryG)',
  primaryGShadow: 'var(--primaryGShadow)',
  accent:    'var(--accent)',
  yellow:    'var(--yellow)',
  red:       'var(--red)',
  redA:      'var(--redA)',
  blue:      'var(--blue)',
  cyan:      'var(--cyan)',
  cyanD:     'var(--cyanD)',
  green:     'var(--green)',
  shadow:    'var(--shadow)',
  overlay:   'var(--overlay)',
};

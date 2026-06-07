/**
 * config.js — App-wide constants. Shop info is now configurable
 * per-shop via Settings → Shop Info (saved to device storage).
 *
 * SHOP is the FALLBACK / initial defaults shown to a brand-new install.
 * After first save in Settings, values come from shopStorage.
 */

export const APP_NAME = 'Vido Food';
export const APP_TAGLINE = 'Restaurant POS';

export const SHOP = {
  name: 'My Shop',           // Required — user sets in Settings
  branch: '',
  address: '',
  phone: '',
  tax: 0.0875,               // 8.75% default
  currency: 'USD',
  currencySymbol: '$',
  tipPercents: [15, 18, 20, 25],
  sizeLargeBonus: 0.75,
  receiptFooter: 'Thank you! Visit us again',
};

// Format helpers — read SHOP at call time so updates are reflected.
export const formatMoney = (n) => (SHOP.currencySymbol || '$') + (Math.round(n * 100) / 100).toFixed(2);
export const formatUSD = formatMoney; // back-compat alias

export const formatTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const formatDateTime = (d) =>
  new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatDate = (d) =>
  new Date(d).toLocaleDateString();

export const ORDER_TYPES = [
  { id: 'dinein',   label: 'Dine In',  icon: '🏠' },
  { id: 'togo',     label: 'To Go',    icon: '📦' },
  { id: 'delivery', label: 'Delivery', icon: '🚚' },
];

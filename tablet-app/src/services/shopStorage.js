/**
 * shopStorage.js — Per-shop configurable info (name, address, tax, etc.)
 * Saves to persistent storage so each shop has their own settings.
 */

import { getJSON, setJSON } from './storage';
import { SHOP as DEFAULT_SHOP } from '../config';

const KEY = 'vido_shop';

/**
 * Load shop info from storage. Returns defaults if nothing saved yet.
 * Also MUTATES the exported SHOP object so all `import { SHOP }` sees current values.
 */
export async function loadShop() {
  const stored = await getJSON(KEY, null);
  const merged = stored ? { ...DEFAULT_SHOP, ...stored } : { ...DEFAULT_SHOP };
  // Mutate the shared SHOP object so non-reactive code (calcs) sees fresh data
  Object.assign(DEFAULT_SHOP, merged);
  return merged;
}

/**
 * Save shop info to storage + mutate shared SHOP object.
 */
export async function saveShop(shop) {
  const cleaned = {
    name:           String(shop.name || '').trim() || 'My Shop',
    branch:         String(shop.branch || '').trim(),
    address:        String(shop.address || '').trim(),
    phone:          String(shop.phone || '').trim(),
    tax:            Math.max(0, Math.min(1, parseFloat(shop.tax) || 0)),
    currency:       String(shop.currency || 'USD').trim().toUpperCase(),
    currencySymbol: String(shop.currencySymbol || '$'),
    sizeLargeBonus: Math.max(0, parseFloat(shop.sizeLargeBonus) || 0),
    tipPercents:    Array.isArray(shop.tipPercents) ? shop.tipPercents : [15, 18, 20, 25],
    receiptFooter:  String(shop.receiptFooter || 'Thank you! Visit us again').trim(),
  };
  await setJSON(KEY, cleaned);
  Object.assign(DEFAULT_SHOP, cleaned);
  return cleaned;
}

export async function resetShop() {
  // Reset to file defaults — we need the original defaults from config
  // Since we mutate DEFAULT_SHOP, we lose them. Save original as constant here.
  const original = ORIGINAL_DEFAULTS;
  Object.assign(DEFAULT_SHOP, original);
  await setJSON(KEY, null);
  return { ...original };
}

// Snapshot of original defaults captured at module load time (before any mutation)
const ORIGINAL_DEFAULTS = {
  name:           'My Shop',
  branch:         '',
  address:        '',
  phone:          '',
  tax:            0.0875,
  currency:       'USD',
  currencySymbol: '$',
  sizeLargeBonus: 0.75,
  tipPercents:    [15, 18, 20, 25],
  receiptFooter:  'Thank you! Visit us again',
};

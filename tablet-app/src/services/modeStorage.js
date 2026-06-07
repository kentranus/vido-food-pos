/**
 * modeStorage.js — Per-device app mode (POS vs Kiosk).
 *
 * The same APK can run as either a full POS terminal or a customer-facing
 * Kiosk. The mode is chosen per-device in Settings and saved to storage, so
 * one install can be flipped without rebuilding.
 *
 * Default for a brand-new install is 'pos' (a manager signs in, configures the
 * shop, and only then flips a device into kiosk mode if needed).
 */

import { getJSON, setJSON } from './storage';

const KEY = 'vido_device_mode';

export const MODE_POS = 'pos';
export const MODE_KIOSK = 'kiosk';

const VALID = new Set([MODE_POS, MODE_KIOSK]);

// Optional build-time hint: if a build still sets VITE_APP_MODE we honor it as
// the *initial default* only (storage always wins once the user has chosen).
const BUILD_DEFAULT = (import.meta.env.VITE_APP_MODE === MODE_KIOSK) ? MODE_KIOSK : MODE_POS;

/** Load the saved device mode, or the build default if nothing is saved yet. */
export async function loadMode() {
  const stored = await getJSON(KEY, null);
  return VALID.has(stored) ? stored : BUILD_DEFAULT;
}

/** Persist the device mode. Returns the normalized value actually saved. */
export async function saveMode(mode) {
  const next = VALID.has(mode) ? mode : MODE_POS;
  await setJSON(KEY, next);
  return next;
}

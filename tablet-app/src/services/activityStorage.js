/**
 * activityStorage.js — Staff activity audit log.
 *
 * Records WHO did WHAT and WHEN, so the owner can review/control staff actions
 * later from Reports. Sales themselves live in orderStorage (each order already
 * carries staffId/staffName); this log captures the non-sale actions that are
 * easy to lose track of: sign-in/out, discounts, voids, refunds, mode changes,
 * opening protected settings.
 *
 * Stored per-device in storage key `vido_activity`, capped at 5k entries.
 */

import { getJSON, setJSON } from './storage';
import { getCurrentStaff } from './staffStorage';

const KEY = 'vido_activity';
const MAX = 5000;

// Known action types → label + accent used in the Reports feed.
export const ACTIVITY_TYPES = {
  login:        { label: 'Signed in',          tone: 'green'  },
  logout:       { label: 'Signed out',         tone: 'mute'   },
  sale:         { label: 'Completed sale',     tone: 'primary'},
  discount:     { label: 'Applied discount',   tone: 'yellow' },
  void:         { label: 'Voided order',       tone: 'red'    },
  refund:       { label: 'Refunded order',     tone: 'red'    },
  mode_change:  { label: 'Changed device mode',tone: 'blue'   },
  settings:     { label: 'Opened settings',    tone: 'mute'   },
  menu_change:  { label: 'Edited menu',        tone: 'blue'   },
  staff_change: { label: 'Edited staff',       tone: 'blue'   },
};

/**
 * Append an activity entry. `staff` defaults to the current signed-in staff.
 * Fire-and-forget: never throws into the caller (logging must not break flow).
 */
export async function logActivity(type, detail = '', extra = {}) {
  try {
    const staff = extra.staff || getCurrentStaff() || {};
    const all = await getJSON(KEY, []);
    all.push({
      id: 'A' + Date.now() + Math.floor(performance.now() % 1000),
      ts: new Date().toISOString(),
      type,
      detail: String(detail || ''),
      amount: typeof extra.amount === 'number' ? extra.amount : undefined,
      staffId: staff.id || 'unknown',
      staffName: staff.name || 'Unknown',
      role: staff.role || '',
      avatar: staff.avatar || '',
    });
    if (all.length > MAX) all.splice(0, all.length - MAX);
    await setJSON(KEY, all);
  } catch {
    /* logging is best-effort */
  }
}

export async function loadAllActivity() {
  return getJSON(KEY, []);
}

export async function loadActivityInRange(start, end) {
  const all = await loadAllActivity();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return all
    .filter(a => { const t = new Date(a.ts).getTime(); return t >= s && t <= e; })
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

export async function clearActivity() {
  await setJSON(KEY, []);
}

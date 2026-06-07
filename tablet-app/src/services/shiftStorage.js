/**
 * shiftStorage.js — staff shift (clock in / clock out) tracking.
 * A shift opens when a staff member signs in with their PIN and closes when
 * they sign out. Stored locally (offline-first); used for accountability and
 * "who was on" reporting. Kept intentionally small for v1.
 */

import { getJSON, setJSON } from './storage';

const KEY = 'vido_shifts';
const MAX = 2000;

let _current = null; // in-memory pointer to the open shift for this session

export async function loadShifts() {
  return (await getJSON(KEY, [])) || [];
}

export function currentShift() {
  return _current;
}

/** Open a shift for a staff member (called right after PIN sign-in). */
export async function startShift(staff) {
  if (!staff || staff.role === 'kiosk') return null;
  const shift = {
    id: 'sh_' + Date.now(),
    staffId: staff.id || '',
    staffName: staff.name || '',
    role: staff.role || '',
    clockInAt: new Date().toISOString(),
    clockOutAt: null,
  };
  const all = await loadShifts();
  all.unshift(shift);
  if (all.length > MAX) all.length = MAX;
  await setJSON(KEY, all);
  _current = shift;
  return shift;
}

/** Close the open shift (called on sign-out). */
export async function endShift() {
  if (!_current) return null;
  const all = await loadShifts();
  const row = all.find((s) => s.id === _current.id);
  if (row && !row.clockOutAt) {
    row.clockOutAt = new Date().toISOString();
    await setJSON(KEY, all);
  }
  const closed = row || _current;
  _current = null;
  return closed;
}

/** Shifts overlapping a [start,end] window, newest first. */
export async function shiftsInRange(start, end) {
  const s = +new Date(start);
  const e = +new Date(end);
  const all = await loadShifts();
  return all.filter((sh) => {
    const inAt = +new Date(sh.clockInAt);
    return inAt >= s && inAt <= e;
  });
}

/**
 * staffStorage.js — Staff PINs and roles.
 * Default Manager: 1234, Cashier: 0000.
 * Manager role required for: refunds, voids, discounts, settings changes.
 */

import { getJSON, setJSON } from './storage';

const KEY = 'vido_staff';

const DEFAULT_STAFF = [
  { id: 's1', name: 'Manager',   role: 'manager', pin: '1234', active: true },
  { id: 's2', name: 'Cashier 1', role: 'cashier', pin: '0000', active: true },
];

export async function loadStaff() {
  return getJSON(KEY, DEFAULT_STAFF);
}

export async function saveStaff(staff) {
  return setJSON(KEY, staff);
}

/**
 * Verify a PIN and return matching staff member, or null.
 */
export async function verifyPin(pin) {
  const staff = await loadStaff();
  return staff.find(s => s.active && s.pin === pin) || null;
}

/**
 * Check if a PIN belongs to a manager.
 */
export async function verifyManagerPin(pin) {
  const s = await verifyPin(pin);
  return s && s.role === 'manager' ? s : null;
}

export async function addStaff(member) {
  const all = await loadStaff();
  all.push({ ...member, id: 's' + Date.now(), active: true });
  await saveStaff(all);
  return all;
}

export async function updateStaff(id, updates) {
  const all = await loadStaff();
  const next = all.map(s => s.id === id ? { ...s, ...updates } : s);
  await saveStaff(next);
  return next;
}

export async function deleteStaff(id) {
  const all = await loadStaff();
  // never delete the last manager
  const managers = all.filter(s => s.role === 'manager' && s.id !== id);
  if (managers.length === 0 && all.find(s => s.id === id)?.role === 'manager') {
    throw new Error('Cannot delete the last manager');
  }
  const next = all.filter(s => s.id !== id);
  await saveStaff(next);
  return next;
}

/**
 * Current logged-in staff (in-memory session)
 */
let _currentStaff = null;

export function setCurrentStaff(staff) { _currentStaff = staff; }
export function getCurrentStaff()       { return _currentStaff; }
export function clearCurrentStaff()     { _currentStaff = null; }

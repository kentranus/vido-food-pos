/**
 * orderStorage.js — persistent order log for Reports.
 * Each completed order is appended. Capped at 10k entries.
 */

import { getJSON, setJSON } from './storage';

const KEY = 'vido_orders';
const MAX_ORDERS = 10000;

// ============================================================================
// PERSISTENT ORDER NUMBER COUNTER
// Survives app restarts so receipt/kitchen numbers don't collide each session.
// Per-device (each POS/kiosk tablet keeps its own sequence). The POS Hub also
// assigns its own shared number for kiosk/online orders.
// ============================================================================
const COUNTER_KEY = 'vido_order_counter';
let _seed = 1042;
let _seedLoaded = false;

/** Load the saved counter into memory. Call once at app boot BEFORE first order. */
export async function initOrderCounter() {
  const v = await getJSON(COUNTER_KEY, 1042);
  _seed = Number(v) || 1042;
  _seedLoaded = true;
  return _seed;
}

/** Next order number. Increments + persists (fire-and-forget). */
export function nextOrderNumber() {
  _seed += 1;
  // Persist without blocking; safe even if init hasn't finished (defaults to 1042).
  setJSON(COUNTER_KEY, _seed).catch(() => {});
  return _seed;
}

export function isOrderCounterReady() { return _seedLoaded; }

export async function saveOrder(order) {
  const all = await loadAllOrders();
  const stored = {
    ...order,
    completedAt: order.completedAt
      ? (typeof order.completedAt === 'string' ? order.completedAt : order.completedAt.toISOString())
      : new Date().toISOString(),
    createdAt: order.createdAt
      ? (typeof order.createdAt === 'string' ? order.createdAt : order.createdAt.toISOString())
      : new Date().toISOString(),
  };
  all.push(stored);
  if (all.length > MAX_ORDERS) all.splice(0, all.length - MAX_ORDERS);
  await setJSON(KEY, all);
  return stored;
}

export async function loadAllOrders() {
  return getJSON(KEY, []);
}

export async function loadOrdersInRange(start, end) {
  const all = await loadAllOrders();
  const startMs = new Date(start).getTime();
  const endMs   = new Date(end).getTime();
  return all.filter(o => {
    const t = new Date(o.completedAt || o.createdAt).getTime();
    return t >= startMs && t <= endMs;
  });
}

export async function clearAllOrders() {
  await setJSON(KEY, []);
}

export async function deleteOrder(id) {
  const all = await loadAllOrders();
  await setJSON(KEY, all.filter(o => o.id !== id));
}

export async function updateOrderRecord(id, updates) {
  const all = await loadAllOrders();
  const next = all.map(o => o.id === id ? { ...o, ...updates, updatedAt: new Date().toISOString() } : o);
  await setJSON(KEY, next);
  return next.find(o => o.id === id) || null;
}

export async function markOrderVoided(id, reason = '') {
  return updateOrderRecord(id, {
    status: 'voided',
    voidedAt: new Date().toISOString(),
    voidReason: reason,
  });
}

export async function markOrderRefunded(id, amount, reason = '') {
  return updateOrderRecord(id, {
    refundAmount: Math.max(0, parseFloat(amount) || 0),
    refundedAt: new Date().toISOString(),
    refundReason: reason,
    status: 'refunded',
  });
}

// ============================================================================
// DATE RANGES (helpers for Reports filter)
// ============================================================================
export const DateRanges = {
  today: () => {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: 'Today' };
  },
  yesterday: () => {
    const s = new Date(); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: 'Yesterday' };
  },
  thisWeek: () => {
    const s = new Date();
    const day = s.getDay() || 7;
    s.setDate(s.getDate() - day + 1);
    s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: 'This Week' };
  },
  thisMonth: () => {
    const s = new Date(); s.setDate(1); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: 'This Month' };
  },
  last7Days: () => {
    const s = new Date(); s.setDate(s.getDate() - 7); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: 'Last 7 Days' };
  },
  last30Days: () => {
    const s = new Date(); s.setDate(s.getDate() - 30); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return { start: s, end: e, label: 'Last 30 Days' };
  },
};

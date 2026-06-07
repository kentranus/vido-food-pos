/**
 * cloudService.js — connects this POS device to the Vido Food cloud
 * (api.vidofood.com). It binds the device to ONE restaurant (tenant) via the
 * owner's account login, then lets the POS receive that restaurant's online
 * (web) orders so the owner can confirm them — confirming captures the card
 * (charges the customer) and prints a kitchen ticket.
 *
 * The session token is persisted (Capacitor Preferences on device) so the
 * device stays linked across restarts. Online card capture / void happen
 * SERVER-side; this client only triggers accept / reject.
 */

import { getJSON, setJSON } from './storage';

const KEY = 'vido_cloud_session';
const DEFAULT_BASE = 'https://api.vidofood.com';

class CloudService {
  constructor() {
    this.config = { baseUrl: DEFAULT_BASE, token: '', store: null, account: null };
    this.ready = this._load();
  }

  async _load() {
    const saved = await getJSON(KEY, null);
    if (saved && typeof saved === 'object') this.config = { ...this.config, ...saved };
    if (!this.config.baseUrl) this.config.baseUrl = DEFAULT_BASE;
    return this.config;
  }

  async _persist() { await setJSON(KEY, this.config); }

  isLoggedIn() { return Boolean(this.config.token && this.config.store); }
  storeName() { return this.config.store?.name || ''; }
  storeSlug() { return this.config.store?.slug || ''; }
  businessType() { return this.config.store?.businessType || 'quick_service'; }
  isFullService() { return this.businessType() === 'full_service'; }
  baseUrl() { return String(this.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, ''); }

  /**
   * License gate. Calls the backend; on success caches {allowed, at} so the
   * POS keeps working OFFLINE for up to offlineGraceHours (default 48h).
   * Returns { allowed, reason, offline }.
   */
  async checkLicense() {
    if (!this.isLoggedIn()) return { allowed: false, reason: 'not_linked' };
    const j = await this._fetch('/api/license/check');
    const cache = this.config.lastLicense || null;
    if (j.offline || j.status === 0) {
      const graceHours = cache?.offlineGraceHours || 48;
      if (cache?.allowed && cache.at && (Date.now() - cache.at) < graceHours * 3600 * 1000) {
        return { allowed: true, reason: 'offline_grace', offline: true };
      }
      return { allowed: false, reason: 'offline_no_cache', offline: true };
    }
    if (j.status === 401) return { allowed: false, reason: 'session_expired' };
    if (j.ok) {
      // Refresh cached store fields (businessType may have changed admin-side).
      if (j.store?.name && this.config.store) this.config.store.name = j.store.name;
      this.config.lastLicense = {
        allowed: Boolean(j.allowed), reason: j.reason || '',
        offlineGraceHours: j.offlineGraceHours || 48, at: Date.now(),
      };
      await this._persist();
      return { allowed: Boolean(j.allowed), reason: j.reason || '' };
    }
    return { allowed: false, reason: j.error || 'unknown' };
  }

  async _fetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth && this.config.token) headers.authorization = 'Bearer ' + this.config.token;
    let res;
    try {
      res = await fetch(this.baseUrl() + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, error: 'No connection: ' + e.message, offline: true };
    }
    let json = {};
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, ...json };
  }

  /** Log the device in with a restaurant (store owner) account. */
  async login(email, password, baseUrl) {
    if (baseUrl) this.config.baseUrl = String(baseUrl).replace(/\/+$/, '');
    const j = await this._fetch('/api/auth/login', {
      method: 'POST', auth: false,
      body: { email: String(email || '').trim(), password: String(password || ''), deviceId: 'pos' },
    });
    if (!j.ok) return { ok: false, error: j.error || 'Sign in failed' };
    if (j.account?.role === 'SUPER_ADMIN' || !j.store) {
      return { ok: false, error: 'Use your restaurant (owner) account here, not the Vido admin account.' };
    }
    this.config.token = j.token;
    this.config.store = { id: j.store.id, slug: j.store.slug, name: j.store.name };
    this.config.account = { id: j.account.id, name: j.account.name, email: j.account.email, role: j.account.role };
    await this._persist();
    return { ok: true, store: this.config.store };
  }

  /** Unlink this device from the restaurant. */
  async logout() {
    try { await this._fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    this.config.token = '';
    this.config.store = null;
    this.config.account = null;
    await this._persist();
  }

  /** All online orders for the linked store (auth required). */
  async fetchOnlineOrders() {
    if (!this.isLoggedIn()) return { ok: false, orders: [] };
    const j = await this._fetch('/api/online-orders');
    if (j.status === 401) return { ok: false, expired: true, orders: [] };
    return { ok: Boolean(j.ok), orders: Array.isArray(j.orders) ? j.orders : [], offline: j.offline };
  }

  /** Owner confirms → server CAPTURES the card (charges customer) + marks accepted. */
  acceptOrder(id, etaMinutes) {
    return this._fetch(`/api/online-orders/${encodeURIComponent(id)}/accept`, {
      method: 'POST', body: { etaMinutes: etaMinutes || null },
    });
  }

  /** Owner rejects → server VOIDS the authorization (customer not charged). */
  rejectOrder(id, reason) {
    return this._fetch(`/api/online-orders/${encodeURIComponent(id)}/reject`, {
      method: 'POST', body: { reason: reason || '' },
    });
  }

  /** Mark an accepted order as ready for pickup (sends customer SMS). */
  markReady(id) {
    return this._fetch(`/api/online-orders/${encodeURIComponent(id)}/ready`, { method: 'POST', body: {} });
  }

  /** Generic status move (e.g. 'preparing', 'completed') — syncs back to the web order. */
  setStatus(id, status) {
    return this._fetch(`/api/online-orders/${encodeURIComponent(id)}/update`, { method: 'POST', body: { status } });
  }

  /** Register this device's FCM token so the server can push new-order alerts. */
  registerFcmToken(token) {
    if (!token) return Promise.resolve({ ok: false });
    return this._fetch('/api/devices/fcm-token', { method: 'POST', body: { token, platform: 'android' } });
  }

  /** Acknowledge the ticket was printed so it stops flagging shouldPrint. */
  markPrinted(id) {
    return this._fetch(`/api/online-orders/${encodeURIComponent(id)}/print`, {
      method: 'POST', body: { status: 'accepted' },
    });
  }
}

export const cloudService = new CloudService();

/** True for orders still waiting on the owner's confirm decision. */
export function isPendingOnline(o) {
  return o && (o.status === 'pending_accept' || o.status === 'new') && String(o.source || '').toLowerCase().includes('online');
}

/** Map a cloud online order → the local kitchen-ticket shape printKitchenTicket expects. */
export function onlineOrderToTicket(o) {
  return {
    number: o.number || o.id,
    type: o.orderType || 'PICKUP',
    source: 'Online',
    completedAt: new Date().toISOString(),
    customerName: o.customer || o.customerName || '',
    customerPhone: o.customerPhone || '',
    tableNumber: o.tableNumber || '',
    items: (o.items || []).map((it) => ({
      qty: it.quantity || 1,
      name: it.nameSnapshot || it.name || 'Item',
      category: 'snack', // skip the boba sugar/ice auto-line; web modifiers are listed below
      toppings: (it.modifiers || []).map((m) => ({ name: m.optionName || m.name })),
      note: it.notes || '', // per-item instruction, e.g. "less ice"
    })),
    note: o.notes || '', // order-level note
  };
}

/** Map a confirmed cloud order → a local order record for history/reports. */
export function onlineOrderToLocal(o, staffName) {
  return {
    id: 'CLOUD-' + o.id,
    number: o.number || o.id,
    type: String(o.orderType || 'pickup').toLowerCase(),
    source: 'online',
    items: (o.items || []).map((it) => ({
      name: it.nameSnapshot || it.name || 'Item',
      qty: it.quantity || 1,
      basePrice: Number(it.priceSnapshot || 0),
      size: 'R',
      toppings: (it.modifiers || []).map((m) => ({ name: m.optionName || m.name, price: Number(m.priceDelta || 0) })),
      note: it.notes || '',
    })),
    discount: 0,
    taxAmount: Number(o.tax || 0),
    tip: Number(o.tip || 0),
    status: 'complete',
    paymentMethod: (o.paymentStatus === 'captured' || o.paymentMethod === 'card') ? 'card' : 'cash',
    cardLast4: o.cardLast4 || '',
    completedAt: new Date().toISOString(),
    staffName: staffName || 'Online',
    customerName: o.customer || o.customerName || '',
    receiptPhone: o.customerPhone || '',
  };
}

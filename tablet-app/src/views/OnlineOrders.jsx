import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, CheckCircle2, XCircle, Wifi, WifiOff, Store, LogOut, Loader2, ShoppingBag } from 'lucide-react';
import { C } from '../theme';
import { formatUSD } from '../config';
import { Button, Input, Field, Modal, ModalClose, BrandMark } from '../components/Shared';
import { cloudService, isPendingOnline, onlineOrderToTicket, onlineOrderToLocal } from '../services/cloudService';
import { saveOrder } from '../services/orderStorage';
import { logActivity } from '../services/activityStorage';
import { printKitchenTicket } from './OrderView';

// ---------------------------------------------------------------------------
// Small "new order" chime via Web Audio (no asset needed).
// ---------------------------------------------------------------------------
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (freq, start, dur) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur);
    };
    beep(880, 0, 0.18);
    beep(1175, 0.18, 0.28);
    setTimeout(() => ctx.close(), 900);
  } catch { /* audio not available */ }
}

// ===========================================================================
// CLOUD LOGIN SCREEN — the device must link to a restaurant account before
// the POS can be used. Persisted, so this is a one-time step per device.
// ===========================================================================
export function CloudLoginScreen({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [baseUrl, setBaseUrl] = useState(cloudService.baseUrl());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() || !password) { setError('Enter your restaurant email and password.'); return; }
    setBusy(true); setError('');
    const r = await cloudService.login(email, password, baseUrl);
    setBusy(false);
    if (!r.ok) { setError(r.error || 'Sign in failed'); return; }
    logActivity('cloud_link', `Linked device to ${r.store?.name || 'restaurant'}`);
    onDone?.(r.store);
  };

  return (
    <div style={ls.wrap}>
      <div style={ls.card}>
        <div style={ls.brandRow}>
          <BrandMark size={56} radius={16} />
          <div>
            <div style={ls.title}>Vido Food POS</div>
            <div style={ls.sub}>Sign in with your restaurant account</div>
          </div>
        </div>
        <div style={ls.hint}>This links the device to your restaurant so online orders arrive here. You only do this once.</div>

        <Field label="Restaurant email">
          <Input value={email} autoCapitalize="none" autoCorrect="off" placeholder="owner@restaurant.com"
            onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        </Field>
        <Field label="Password">
          <Input value={password} type="password" placeholder="••••••••"
            onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        </Field>

        {showAdvanced && (
          <Field label="Server URL (advanced)" hint="Leave as default unless told otherwise.">
            <Input value={baseUrl} autoCapitalize="none" onChange={e => setBaseUrl(e.target.value)} />
          </Field>
        )}

        {error && <div style={ls.error}>{error}</div>}

        <Button onClick={submit} disabled={busy} style={{ width: '100%', marginTop: 6, justifyContent: 'center' }}>
          {busy ? <><Loader2 size={16} className="spin" /> Signing in…</> : 'Sign in & link device'}
        </Button>
        <button onClick={() => setShowAdvanced(v => !v)} style={ls.advBtn}>
          {showAdvanced ? 'Hide' : 'Advanced'} settings
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// LICENSE LOCK SCREEN — shown when the restaurant's subscription is not active
// (expired / suspended / cancelled) or offline grace ran out. Blocks the POS.
// ===========================================================================
const LICENSE_MESSAGES = {
  expired: 'Your subscription has expired.',
  past_due: 'Your subscription payment is past due.',
  tenant_suspended: 'This account has been suspended.',
  tenant_cancelled: 'This account has been cancelled.',
  tenant_pending: 'This account is not active yet.',
  session_expired: 'Session expired — please sign in again.',
  offline_no_cache: 'No internet and the offline period has ended.',
  not_linked: 'This device is not linked to a restaurant.',
};
export function LicenseLockScreen({ reason, onRecheck, onSwitch }) {
  const [busy, setBusy] = useState(false);
  const msg = LICENSE_MESSAGES[reason] || 'Access is locked.';
  const recheck = async () => { setBusy(true); await onRecheck?.(); setBusy(false); };
  return (
    <div style={ls.wrap}>
      <div style={ls.card}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={lk.lockIcon}><WifiOff size={26} /></div>
          <div style={ls.title}>POS locked</div>
          <div style={{ ...ls.sub, marginTop: 6 }}>{msg}</div>
        </div>
        <div style={lk.contact}>Please contact <b>Vido</b> to reactivate your account, then re-check.</div>
        <Button onClick={recheck} disabled={busy} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
          {busy ? <><Loader2 size={16} className="spin" /> Checking…</> : 'Re-check now'}
        </Button>
        <button onClick={onSwitch} style={ls.advBtn}>Switch / unlink account</button>
      </div>
    </div>
  );
}

// ===========================================================================
// ONLINE ORDER CENTER — floating bell + badge always visible in the POS.
// Polls the cloud for pending web orders, chimes + auto-opens on a new one,
// and lets the owner Confirm (capture card + print ticket) or Reject (void).
// ===========================================================================
export function OnlineOrderCenter({ staff }) {
  const [pending, setPending] = useState([]);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const seenRef = useRef(new Set());
  const firstLoadRef = useRef(true);

  const poll = useCallback(async () => {
    if (!cloudService.isLoggedIn()) return;
    const res = await cloudService.fetchOnlineOrders();
    if (res.offline) { setOnline(false); return; }
    setOnline(true);
    if (!res.ok) return;
    const nextPending = (res.orders || []).filter(isPendingOnline);

    // Detect genuinely new pending orders (chime + auto-open).
    let hasNew = false;
    for (const o of nextPending) {
      if (!seenRef.current.has(o.id)) { seenRef.current.add(o.id); if (!firstLoadRef.current) hasNew = true; }
    }
    firstLoadRef.current = false;
    setPending(nextPending);
    if (hasNew) { playChime(); setOpen(true); }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [poll]);

  const confirm = async (o) => {
    setBusyId(o.id); setError('');
    const r = await cloudService.acceptOrder(o.id, o.etaMinutes);
    if (!r || !r.ok) { setBusyId(''); setError(r?.error || 'Confirm failed — card not charged.'); return; }
    // Print kitchen ticket, then record locally for reports.
    try { await printKitchenTicket(onlineOrderToTicket(o)); } catch (e) { console.warn('online ticket print failed', e); }
    try { await saveOrder(onlineOrderToLocal(o, staff?.name)); } catch { /* non-fatal */ }
    try { await cloudService.markPrinted(o.id); } catch { /* non-fatal */ }
    logActivity('online_confirm', `Confirmed online order #${o.number || o.id} (${formatUSD(Number(o.total || 0))})`, { staff });
    setPending(p => p.filter(x => x.id !== o.id));
    setBusyId('');
  };

  const reject = async (o) => {
    if (!window.confirm(`Reject online order from ${o.customer || 'customer'}? The card will NOT be charged.`)) return;
    setBusyId(o.id); setError('');
    const r = await cloudService.rejectOrder(o.id, '');
    setBusyId('');
    if (!r || !r.ok) { setError(r?.error || 'Reject failed'); return; }
    logActivity('online_reject', `Rejected online order #${o.number || o.id}`, { staff });
    setPending(p => p.filter(x => x.id !== o.id));
  };

  const count = pending.length;

  return (
    <>
      {/* Floating bell + badge */}
      <button onClick={() => setOpen(true)} style={{ ...oc.fab, background: count ? C.primary : C.panel, color: count ? C.bg : C.textMute }}>
        <Bell size={22} />
        {count > 0 && <span style={oc.badge}>{count}</span>}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth={620}>
          <div style={{ padding: 22 }}>
            <ModalClose onClose={() => setOpen(false)} />
            <div style={oc.head}>
              <div style={oc.title}><ShoppingBag size={18} /> Online Orders</div>
              <div style={{ ...oc.netPill, color: online ? C.green : C.red, background: online ? 'rgba(74,222,128,0.12)' : C.redA }}>
                {online ? <Wifi size={12} /> : <WifiOff size={12} />} {online ? 'Connected' : 'Offline'}
              </div>
            </div>
            <div style={oc.storeLine}><Store size={12} /> {cloudService.storeName() || 'This restaurant'}</div>

            {error && <div style={oc.error}>{error}</div>}

            {count === 0 ? (
              <div style={oc.empty}><CheckCircle2 size={22} color={C.green} /> No orders waiting. New web orders pop up here automatically.</div>
            ) : (
              <div style={oc.list}>
                {pending.map(o => (
                  <OnlineOrderCard key={o.id} o={o} busy={busyId === o.id} onConfirm={() => confirm(o)} onReject={() => reject(o)} />
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function OnlineOrderCard({ o, busy, onConfirm, onReject }) {
  const paid = o.paymentStatus === 'authorized' || o.paymentStatus === 'captured' || o.paymentMethod === 'card';
  return (
    <div style={oc.card}>
      <div style={oc.cardTop}>
        <div style={{ minWidth: 0 }}>
          <div style={oc.cust}>{o.customer || o.customerName || 'Customer'}{o.customerPhone ? ` · ${o.customerPhone}` : ''}</div>
          <div style={oc.meta}>#{o.number || o.id} · {(o.orderType || 'PICKUP')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={oc.total}>{formatUSD(Number(o.total || 0))}</div>
          <div style={{ ...oc.payPill, color: paid ? C.blue : C.textMute, background: paid ? 'rgba(96,165,250,0.14)' : C.card }}>
            {paid ? 'Card on hold' : 'Pay at store'}
          </div>
        </div>
      </div>

      <div style={oc.items}>
        {(o.items || []).map((it, i) => (
          <div key={i} style={oc.itemRow}>
            <span style={oc.itemQty}>{it.quantity || 1}×</span>
            <span style={oc.itemName}>
              {it.nameSnapshot || it.name}
              {(it.modifiers || []).length > 0 && (
                <span style={oc.mods}> — {(it.modifiers || []).map(m => m.optionName || m.name).join(', ')}</span>
              )}
              {it.notes ? <span style={oc.mods}> · “{it.notes}”</span> : null}
            </span>
          </div>
        ))}
      </div>

      <div style={oc.actions}>
        <button onClick={onReject} disabled={busy} style={oc.rejectBtn}><XCircle size={16} /> Reject</button>
        <button onClick={onConfirm} disabled={busy} style={oc.confirmBtn}>
          {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
          {paid ? ' Confirm & charge' : ' Confirm'} + print
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// STYLES
// ===========================================================================
const ls = {
  wrap: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 18 },
  card: { width: 420, maxWidth: '100%', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 18, padding: 26, boxShadow: `0 20px 60px ${C.shadow}` },
  brandRow: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 },
  title: { fontSize: 21, fontWeight: 900, color: C.text },
  sub: { fontSize: 12, fontWeight: 700, color: C.textMute, marginTop: 2 },
  hint: { fontSize: 12, fontWeight: 600, color: C.textMute, margin: '12px 0 18px', lineHeight: 1.4 },
  error: { background: C.redA, color: C.red, borderRadius: 10, padding: '10px 12px', fontSize: 12, fontWeight: 800, margin: '6px 0' },
  advBtn: { width: '100%', background: 'transparent', border: 'none', color: C.textMute, fontWeight: 800, fontSize: 12, marginTop: 12, cursor: 'pointer' },
};

const lk = {
  lockIcon: { width: 60, height: 60, borderRadius: 999, background: C.redA, color: C.red, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' },
  contact: { fontSize: 12, fontWeight: 600, color: C.textMute, textAlign: 'center', margin: '14px 0 16px', lineHeight: 1.5 },
};

const oc = {
  fab: { position: 'fixed', right: 18, bottom: 18, width: 56, height: 56, borderRadius: 999, border: `1px solid ${C.border}`, boxShadow: `0 10px 30px ${C.shadow}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80 },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, padding: '0 5px', borderRadius: 999, background: C.red, color: '#fff', fontSize: 12, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${C.panel}` },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { fontSize: 19, fontWeight: 900, color: C.text, display: 'flex', alignItems: 'center', gap: 8 },
  netPill: { fontSize: 11, fontWeight: 900, borderRadius: 999, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 },
  storeLine: { fontSize: 12, fontWeight: 800, color: C.textMute, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 14 },
  error: { background: C.redA, color: C.red, borderRadius: 10, padding: '10px 12px', fontSize: 12, fontWeight: 800, marginBottom: 12 },
  empty: { minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.textMute, fontSize: 13, fontWeight: 800, textAlign: 'center' },
  list: { display: 'grid', gap: 12, maxHeight: '62vh', overflowY: 'auto' },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  cust: { fontSize: 15, fontWeight: 900, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  meta: { fontSize: 11, fontWeight: 700, color: C.textMute, marginTop: 2 },
  total: { fontSize: 17, fontWeight: 900, color: C.text },
  payPill: { fontSize: 10, fontWeight: 900, borderRadius: 999, padding: '3px 8px', marginTop: 3, display: 'inline-block' },
  items: { margin: '12px 0', display: 'grid', gap: 5, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '10px 0' },
  itemRow: { display: 'flex', gap: 8, fontSize: 13, color: C.text, fontWeight: 700 },
  itemQty: { fontWeight: 900, color: C.primary, minWidth: 28 },
  itemName: { flex: 1 },
  mods: { color: C.textMute, fontWeight: 600 },
  actions: { display: 'flex', gap: 10 },
  rejectBtn: { flex: 1, background: C.redA, color: C.red, border: `1px solid ${C.red}`, borderRadius: 10, padding: '11px', fontWeight: 900, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmBtn: { flex: 2, background: C.green, color: '#06210f', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 900, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 },
};

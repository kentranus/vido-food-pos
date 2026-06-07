import React, { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';
import {
  Bell, CheckCircle2, XCircle, Wifi, WifiOff, Store, Loader2, ShoppingBag,
  Clock, Phone, ChevronLeft, Flame, Package,
} from 'lucide-react';
import { C } from '../theme';
import { formatUSD } from '../config';
import { Button, Input, Field, Modal, ModalClose, BrandMark } from '../components/Shared';
import { cloudService, onlineOrderToTicket, onlineOrderToLocal } from '../services/cloudService';
import { saveOrder } from '../services/orderStorage';
import { logActivity } from '../services/activityStorage';
import { printKitchenTicket } from './OrderView';

// ---------------------------------------------------------------------------
// "New order" chime — a short two-tone beep that LOOPS until staff acts
// (like a DoorDash tablet). Module-level so it survives re-renders.
// ---------------------------------------------------------------------------
function chimeOnce() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (freq, start, dur) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur);
    };
    beep(880, 0, 0.18); beep(1175, 0.2, 0.3);
    setTimeout(() => ctx.close(), 1000);
  } catch { /* audio unavailable */ }
}
let _chimeTimer = null;
function startChimeLoop() { if (_chimeTimer) return; chimeOnce(); _chimeTimer = setInterval(chimeOnce, 2200); }
function stopChimeLoop() { if (_chimeTimer) { clearInterval(_chimeTimer); _chimeTimer = null; } }

// ---------------------------------------------------------------------------
// Order grouping + source colour (ONLINE orange / KIOSK purple / POS grey).
// ---------------------------------------------------------------------------
const NEW_ST = ['pending_accept', 'new'];
const PREP_ST = ['accepted', 'preparing'];
const READY_ST = ['ready'];

function sourceMeta(order) {
  const s = String(order.source || 'pos').toLowerCase();
  if (s.includes('online') || s.includes('web')) return { label: 'ONLINE', color: '#FF6A00' };
  if (s.includes('kiosk')) return { label: 'KIOSK', color: '#8B5CF6' };
  return { label: 'POS', color: '#64748B' };
}
function columnOf(o) {
  const s = o.status;
  const src = String(o.source || '').toLowerCase();
  if (READY_ST.includes(s)) return 'ready';
  if (PREP_ST.includes(s)) return 'preparing';
  if (NEW_ST.includes(s)) return src.includes('kiosk') ? 'preparing' : 'new'; // kiosk = pre-paid, no accept
  return null; // rejected / voided / completed → off the board
}
function minsAgo(iso) {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : `${m}m ago`;
}
const custName = (o) => o.customer || o.customerName || 'Customer';

// ===========================================================================
// CLOUD LOGIN SCREEN — device links to a restaurant account (one-time).
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
        <button onClick={() => setShowAdvanced(v => !v)} style={ls.advBtn}>{showAdvanced ? 'Hide' : 'Advanced'} settings</button>
      </div>
    </div>
  );
}

// ===========================================================================
// LICENSE LOCK SCREEN — subscription inactive / offline grace ended.
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
// ONLINE ORDERS PROVIDER — single source of truth for live online/kiosk
// orders. Realtime via SSE (foreground), polling fallback, chime loop, and
// the accept / reject / ready / complete actions used by the takeover + board.
// ===========================================================================
const OnlineOrdersContext = createContext(null);
export function useOnlineOrders() { return useContext(OnlineOrdersContext); }

export function OnlineOrdersProvider({ staff, children }) {
  const [orders, setOrders] = useState([]);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState([]); // NEW online orders awaiting accept (drives the takeover)
  const seenRef = useRef(new Set());
  const firstRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!cloudService.isLoggedIn()) return;
    const res = await cloudService.fetchOnlineOrders();
    if (res.offline) { setOnline(false); return; }
    setOnline(true);
    if (!res.ok) return;
    const active = (res.orders || []).filter(o => columnOf(o) !== null)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    setOrders(active);
    const fresh = active.filter(o => columnOf(o) === 'new');
    let hasNew = false;
    for (const o of fresh) { if (!seenRef.current.has(o.id)) { seenRef.current.add(o.id); if (!firstRef.current) hasNew = true; } }
    firstRef.current = false;
    setQueue(fresh);
    if (hasNew) startChimeLoop();
  }, []);

  // SSE for instant updates while the app is open; 15s poll as a safety net.
  useEffect(() => {
    refresh();
    let es = null;
    const tok = cloudService.config.token;
    if (typeof EventSource !== 'undefined' && tok) {
      try {
        es = new EventSource(`${cloudService.baseUrl()}/api/events?token=${encodeURIComponent(tok)}`);
        const onEv = () => refresh();
        es.onmessage = onEv;
        ['online_order.created', 'online_order.accept', 'online_order.reject', 'online_order.ready',
          'online_order.updated', 'online_order.print', 'kiosk_order.created'].forEach(ev => es.addEventListener(ev, onEv));
      } catch { /* SSE unsupported */ }
    }
    const poll = setInterval(refresh, 15000);
    return () => { if (es) es.close(); clearInterval(poll); };
  }, [refresh]);

  useEffect(() => { if (queue.length === 0) stopChimeLoop(); }, [queue.length]);
  useEffect(() => () => stopChimeLoop(), []);

  const accept = async (o, etaMinutes) => {
    const r = await cloudService.acceptOrder(o.id, etaMinutes); // backend captures the card here
    if (!r || !r.ok) return { ok: false, error: r?.error || 'Confirm failed — card not charged.' };
    try { await printKitchenTicket(onlineOrderToTicket({ ...o, etaMinutes })); } catch (e) { console.warn('print failed', e); }
    try { await saveOrder(onlineOrderToLocal(o, staff?.name)); } catch { /* non-fatal */ }
    try { await cloudService.markPrinted(o.id); } catch { /* non-fatal */ }
    logActivity('online_confirm', `Confirmed online #${o.number || o.id} (${formatUSD(Number(o.total || 0))}, ~${etaMinutes}m)`, { staff });
    await refresh();
    return { ok: true };
  };
  const reject = async (o, reason) => {
    const r = await cloudService.rejectOrder(o.id, reason); // backend voids the authorization
    if (!r || !r.ok) return { ok: false, error: r?.error || 'Reject failed' };
    logActivity('online_reject', `Rejected online #${o.number || o.id} (${reason})`, { staff });
    await refresh();
    return { ok: true };
  };
  const markReady = async (o) => { await cloudService.markReady(o.id); await refresh(); };
  const complete = async (o) => { await cloudService.setStatus(o.id, 'completed'); await refresh(); };

  const value = { orders, online, queue, accept, reject, markReady, complete, refresh, stopChime: stopChimeLoop };
  return <OnlineOrdersContext.Provider value={value}>{children}</OnlineOrdersContext.Provider>;
}

// ===========================================================================
// NEW ORDER TAKEOVER — full-screen, unmissable popup for the front NEW order.
// Accept → prep-time → capture + print; Reject → reason → void.
// ===========================================================================
const PREP_TIMES = [10, 15, 20, 30, 45];
const REJECT_REASONS = ['Too busy', 'Item unavailable', 'Closing soon', 'Other'];

export function NewOrderTakeover() {
  const ctx = useOnlineOrders();
  const o = ctx?.queue?.[0] || null;
  const [step, setStep] = useState('main'); // main | prep | reason
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [customEta, setCustomEta] = useState('');

  useEffect(() => { setStep('main'); setErr(''); setCustomEta(''); }, [o?.id]);
  if (!o) return null;

  const sm = sourceMeta(o);
  const isCard = o.paymentStatus === 'authorized' || o.paymentStatus === 'captured' || o.paymentMethod === 'card';

  const goAccept = () => { ctx.stopChime(); setStep('prep'); };
  const goReject = () => { ctx.stopChime(); setStep('reason'); };
  const confirmAccept = async (eta) => {
    setBusy(true); setErr('');
    const r = await ctx.accept(o, eta);
    setBusy(false);
    if (!r.ok) { setErr(r.error); setStep('main'); }
  };
  const confirmReject = async (reason) => {
    setBusy(true); setErr('');
    const r = await ctx.reject(o, reason);
    setBusy(false);
    if (!r.ok) { setErr(r.error); setStep('main'); }
  };

  return (
    <div style={tk.overlay}>
      <div style={tk.sheet}>
        {/* header */}
        <div style={{ ...tk.banner, background: sm.color }}>
          <span style={tk.bannerLabel}>{sm.label} ORDER</span>
          <span style={tk.bannerTime}><Clock size={14} /> {minsAgo(o.createdAt)}</span>
        </div>
        <div style={tk.headRow}>
          <div style={tk.orderNo}>#{o.number || o.id}</div>
          <div style={tk.typePill}>{String(o.orderType || 'PICKUP').toUpperCase()}{o.tableNumber ? ` · TABLE ${o.tableNumber}` : ''}</div>
        </div>
        <div style={tk.cust}>
          <span style={{ fontWeight: 900 }}>{custName(o)}</span>
          {o.customerPhone && <span style={tk.phone}><Phone size={13} /> {o.customerPhone}</span>}
        </div>

        {/* items */}
        <div style={tk.items}>
          {(o.items || []).map((it, i) => (
            <div key={i} style={tk.itemRow}>
              <span style={tk.qty}>{it.quantity || 1}×</span>
              <span style={tk.itemBody}>
                <span style={tk.itemName}>{it.nameSnapshot || it.name}</span>
                {(it.modifiers || []).length > 0 && (
                  <span style={tk.mods}>{(it.modifiers || []).map(m => m.optionName || m.name).join(', ')}</span>
                )}
                {it.notes ? <span style={tk.inote}>“{it.notes}”</span> : null}
              </span>
            </div>
          ))}
        </div>

        {/* totals */}
        <div style={tk.totals}>
          <Row k="Subtotal" v={formatUSD(Number(o.subtotal || 0))} />
          {Number(o.tax) > 0 && <Row k="Tax" v={formatUSD(Number(o.tax))} />}
          {Number(o.tip) > 0 && <Row k="Tip" v={formatUSD(Number(o.tip))} />}
          <Row k="Total" v={formatUSD(Number(o.total || 0))} big />
          <div style={tk.payTag}>{isCard ? '💳 Card on hold — charged on accept' : '🏪 Pay at store'}</div>
        </div>

        {err && <div style={tk.err}>{err}</div>}

        {/* footer — changes by step */}
        {step === 'main' && (
          <div style={tk.actions}>
            <button onClick={goReject} disabled={busy} style={tk.rejectBtn}><XCircle size={20} /> Reject</button>
            <button onClick={goAccept} disabled={busy} style={tk.acceptBtn}><CheckCircle2 size={22} /> Accept</button>
          </div>
        )}

        {step === 'prep' && (
          <div style={tk.stepWrap}>
            <button onClick={() => setStep('main')} style={tk.back}><ChevronLeft size={16} /> Back</button>
            <div style={tk.stepTitle}>Prep time — when will it be ready?</div>
            <div style={tk.prepGrid}>
              {PREP_TIMES.map(m => (
                <button key={m} disabled={busy} onClick={() => confirmAccept(m)} style={tk.prepBtn}>{m}<span style={tk.prepUnit}>min</span></button>
              ))}
            </div>
            <div style={tk.customRow}>
              <Input value={customEta} type="number" placeholder="Custom min" onChange={e => setCustomEta(e.target.value)} style={{ flex: 1 }} />
              <button disabled={busy || !customEta} onClick={() => confirmAccept(Number(customEta))} style={tk.customGo}>
                {busy ? <Loader2 size={16} className="spin" /> : 'Confirm'}
              </button>
            </div>
            {isCard && <div style={tk.note}>Accepting charges the customer's card now.</div>}
          </div>
        )}

        {step === 'reason' && (
          <div style={tk.stepWrap}>
            <button onClick={() => setStep('main')} style={tk.back}><ChevronLeft size={16} /> Back</button>
            <div style={tk.stepTitle}>Reject reason — the customer is told this</div>
            <div style={tk.reasonGrid}>
              {REJECT_REASONS.map(r => (
                <button key={r} disabled={busy} onClick={() => confirmReject(r)} style={tk.reasonBtn}>{r}</button>
              ))}
            </div>
            <div style={tk.note}>Rejecting voids the authorization — the customer is NOT charged.</div>
          </div>
        )}
      </div>
    </div>
  );
}
function Row({ k, v, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: big ? '6px 0 2px' : '2px 0', fontWeight: big ? 900 : 700, fontSize: big ? 18 : 13, color: big ? C.text : C.textMute }}>
      <span>{k}</span><span style={big ? { color: C.text } : {}}>{v}</span>
    </div>
  );
}

// ===========================================================================
// ORDERS BOARD — kanban view (NEW / PREPARING / READY) like a DoorDash tablet.
// ===========================================================================
const COLS = [
  { key: 'new', title: 'New', icon: Bell, tone: '#FF6A00' },
  { key: 'preparing', title: 'Preparing', icon: Flame, tone: C.primary },
  { key: 'ready', title: 'Ready', icon: Package, tone: C.green },
];

export function OrdersBoard() {
  const ctx = useOnlineOrders();
  const orders = ctx?.orders || [];
  const [sel, setSel] = useState(null);
  const grouped = { new: [], preparing: [], ready: [] };
  orders.forEach(o => { const c = columnOf(o); if (grouped[c]) grouped[c].push(o); });

  return (
    <div style={bd.container}>
      <div style={bd.header}>
        <div>
          <div style={bd.title}>Online Orders</div>
          <div style={bd.sub}>{cloudService.storeName()} · live board</div>
        </div>
        <div style={{ ...bd.netPill, color: ctx?.online ? C.green : C.red, background: ctx?.online ? 'rgba(74,222,128,0.12)' : C.redA }}>
          {ctx?.online ? <Wifi size={13} /> : <WifiOff size={13} />} {ctx?.online ? 'Live' : 'Offline'}
        </div>
      </div>

      <div style={bd.board}>
        {COLS.map(col => {
          const Icon = col.icon;
          const list = grouped[col.key];
          return (
            <div key={col.key} style={bd.col}>
              <div style={{ ...bd.colHead, color: col.tone }}>
                <Icon size={16} /> {col.title}
                <span style={{ ...bd.count, background: col.tone }}>{list.length}</span>
              </div>
              <div style={bd.colBody}>
                {list.length === 0 ? <div style={bd.empty}>—</div> : list.map(o => (
                  <BoardCard key={o.id} o={o} col={col.key} onOpen={() => setSel(o)}
                    onReady={() => ctx.markReady(o)} onComplete={() => ctx.complete(o)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {sel && <OrderDetail o={sel} onClose={() => setSel(null)}
        onReady={() => { ctx.markReady(sel); setSel(null); }}
        onComplete={() => { ctx.complete(sel); setSel(null); }} />}
    </div>
  );
}

function BoardCard({ o, col, onOpen, onReady, onComplete }) {
  const sm = sourceMeta(o);
  return (
    <div style={bd.card} onClick={onOpen}>
      <div style={bd.cardTop}>
        <span style={{ ...bd.srcBadge, background: sm.color }}>{sm.label}</span>
        <span style={bd.cardNo}>#{o.number || o.id}</span>
        <span style={bd.cardTime}>{minsAgo(o.createdAt)}</span>
      </div>
      <div style={bd.cardItems}>
        {(o.items || []).slice(0, 3).map((it, i) => (
          <div key={i} style={bd.cardItem}>{it.quantity || 1}× {it.nameSnapshot || it.name}</div>
        ))}
        {(o.items || []).length > 3 && <div style={bd.more}>+{o.items.length - 3} more</div>}
      </div>
      <div style={bd.cardFoot}>
        <span style={bd.cardCust}>{custName(o)} · {String(o.orderType || 'PICKUP').toLowerCase()}</span>
        <span style={bd.cardTotal}>{formatUSD(Number(o.total || 0))}</span>
      </div>
      {col === 'new' && <div style={bd.awaiting}><Bell size={12} /> Awaiting confirmation</div>}
      {col === 'preparing' && (
        <button style={bd.readyBtn} onClick={(e) => { e.stopPropagation(); onReady(); }}><Package size={14} /> Mark ready</button>
      )}
      {col === 'ready' && (
        <button style={bd.doneBtn} onClick={(e) => { e.stopPropagation(); onComplete(); }}><CheckCircle2 size={14} /> Complete</button>
      )}
    </div>
  );
}

function OrderDetail({ o, onClose, onReady, onComplete }) {
  const sm = sourceMeta(o);
  const col = columnOf(o);
  return (
    <Modal onClose={onClose} maxWidth={460}>
      <div style={{ padding: 20 }}>
        <ModalClose onClose={onClose} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ ...bd.srcBadge, background: sm.color }}>{sm.label}</span>
          <span style={{ fontSize: 20, fontWeight: 900, color: C.text }}>#{o.number || o.id}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMute, marginBottom: 12 }}>
          {custName(o)}{o.customerPhone ? ` · ${o.customerPhone}` : ''} · {String(o.orderType || 'PICKUP')}
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '10px 0', display: 'grid', gap: 6 }}>
          {(o.items || []).map((it, i) => (
            <div key={i} style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
              {it.quantity || 1}× {it.nameSnapshot || it.name}
              {(it.modifiers || []).length > 0 && <span style={{ color: C.textMute, fontWeight: 600 }}> — {(it.modifiers || []).map(m => m.optionName || m.name).join(', ')}</span>}
              {it.notes ? <span style={{ color: C.textMute, fontWeight: 600 }}> · “{it.notes}”</span> : null}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 2px', fontWeight: 900, fontSize: 17, color: C.text }}>
          <span>Total</span><span>{formatUSD(Number(o.total || 0))}</span>
        </div>
        {col === 'preparing' && <Button onClick={onReady} style={{ width: '100%', justifyContent: 'center' }}><Package size={16} /> Mark ready</Button>}
        {col === 'ready' && <Button onClick={onComplete} style={{ width: '100%', justifyContent: 'center' }}><CheckCircle2 size={16} /> Complete order</Button>}
      </div>
    </Modal>
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

const tk = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(8,10,14,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: 560, maxWidth: '100%', maxHeight: '94vh', overflowY: 'auto', background: C.panel, borderRadius: 20, boxShadow: '0 30px 80px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' },
  banner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderRadius: '20px 20px 0 0', color: '#fff' },
  bannerLabel: { fontSize: 20, fontWeight: 900, letterSpacing: 0.5 },
  bannerTime: { fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5, opacity: 0.95 },
  headRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 4px' },
  orderNo: { fontSize: 30, fontWeight: 900, color: C.text },
  typePill: { background: C.card, color: C.text, fontWeight: 900, fontSize: 13, padding: '7px 12px', borderRadius: 999, border: `1px solid ${C.border}` },
  cust: { display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px 10px', fontSize: 15, color: C.text },
  phone: { display: 'flex', alignItems: 'center', gap: 5, color: C.textMute, fontWeight: 700, fontSize: 13 },
  items: { padding: '12px 20px', display: 'grid', gap: 10, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` },
  itemRow: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  qty: { fontSize: 20, fontWeight: 900, color: C.primary, minWidth: 38 },
  itemBody: { display: 'flex', flexDirection: 'column', gap: 2 },
  itemName: { fontSize: 17, fontWeight: 800, color: C.text },
  mods: { fontSize: 13, fontWeight: 600, color: C.textMute },
  inote: { fontSize: 13, fontWeight: 800, color: '#FF6A00' },
  totals: { padding: '12px 20px' },
  payTag: { marginTop: 8, fontSize: 12, fontWeight: 800, color: C.textMute },
  err: { margin: '0 20px', background: C.redA, color: C.red, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 800 },
  actions: { display: 'flex', gap: 12, padding: 20 },
  rejectBtn: { flex: 1, background: C.redA, color: C.red, border: `2px solid ${C.red}`, borderRadius: 14, padding: '18px', fontWeight: 900, fontSize: 17, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  acceptBtn: { flex: 2, background: C.green, color: '#06210f', border: 'none', borderRadius: 14, padding: '18px', fontWeight: 900, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  stepWrap: { padding: 20 },
  back: { background: 'transparent', border: 'none', color: C.textMute, fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10 },
  stepTitle: { fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 14 },
  prepGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 },
  prepBtn: { background: C.card, border: `2px solid ${C.border}`, borderRadius: 14, padding: '16px 0', fontWeight: 900, fontSize: 22, color: C.text, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  prepUnit: { fontSize: 11, fontWeight: 800, color: C.textMute },
  customRow: { display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' },
  customGo: { background: C.green, color: '#06210f', border: 'none', borderRadius: 12, padding: '12px 18px', fontWeight: 900, cursor: 'pointer' },
  reasonGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  reasonBtn: { background: C.card, border: `2px solid ${C.border}`, borderRadius: 14, padding: '18px', fontWeight: 900, fontSize: 15, color: C.text, cursor: 'pointer' },
  note: { marginTop: 14, fontSize: 12, fontWeight: 700, color: C.textMute, textAlign: 'center' },
};

const bd = {
  container: { padding: 20, color: C.text, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 900, color: C.text },
  sub: { fontSize: 13, fontWeight: 700, color: C.textMute, marginTop: 2 },
  netPill: { fontSize: 12, fontWeight: 900, borderRadius: 999, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 },
  board: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, flex: 1, minHeight: 0 },
  col: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, display: 'flex', flexDirection: 'column', minHeight: 0 },
  colHead: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, fontSize: 14, padding: '12px 14px', textTransform: 'uppercase', letterSpacing: 0.4 },
  count: { marginLeft: 'auto', color: '#fff', minWidth: 24, height: 24, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, padding: '0 7px' },
  colBody: { padding: 12, display: 'grid', gap: 10, gridAutoRows: 'min-content', overflowY: 'auto', flex: 1 },
  empty: { textAlign: 'center', color: C.textDim, fontWeight: 800, padding: 20 },
  card: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer', boxShadow: `0 1px 2px ${C.shadow}` },
  cardTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  srcBadge: { color: '#fff', fontWeight: 900, fontSize: 10, padding: '3px 7px', borderRadius: 6, letterSpacing: 0.4 },
  cardNo: { fontSize: 16, fontWeight: 900, color: C.text },
  cardTime: { marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.textMute },
  cardItems: { display: 'grid', gap: 2, marginBottom: 8 },
  cardItem: { fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  more: { fontSize: 11, fontWeight: 700, color: C.textMute },
  cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardCust: { fontSize: 11, fontWeight: 700, color: C.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardTotal: { fontSize: 15, fontWeight: 900, color: C.text },
  awaiting: { marginTop: 8, fontSize: 11, fontWeight: 900, color: '#FF6A00', display: 'flex', alignItems: 'center', gap: 5 },
  readyBtn: { marginTop: 10, width: '100%', background: C.primaryA, color: C.primary, border: `1px solid ${C.primary}`, borderRadius: 10, padding: '9px', fontWeight: 900, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  doneBtn: { marginTop: 10, width: '100%', background: 'rgba(74,222,128,0.14)', color: C.green, border: `1px solid ${C.green}`, borderRadius: 10, padding: '9px', fontWeight: 900, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
};

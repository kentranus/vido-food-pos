import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, Archive, Banknote, CheckCircle2, Clock, CreditCard, FileWarning,
  Monitor, Printer, RefreshCw, RotateCcw, ShieldCheck, ShoppingBag, Wifi,
  XCircle,
} from 'lucide-react';
import { C } from '../theme';
import { SHOP, formatUSD, formatDateTime } from '../config';
import { DateRanges, loadAllOrders, loadOrdersInRange, markOrderRefunded, markOrderVoided, saveOrder } from '../services/orderStorage';
import { logActivity } from '../services/activityStorage';
import { paxService } from '../services/paxBridge';
import { hardwareService } from '../services/hardwareBridge';
import { customerDisplayService } from '../services/customerDisplayBridge';
import { orderHubService } from '../services/orderHubService';
import { ingestHubOrders } from '../services/hubIngest';
import { printKitchenTicket } from './OrderView';
import { Button, Field, Input, Modal, ModalClose } from '../components/Shared';

export function OperationsView({ staff }) {
  const [range] = useState(DateRanges.today());
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cashCounted, setCashCounted] = useState('');
  const [drawerNote, setDrawerNote] = useState('');
  const [deviceState, setDeviceState] = useState({ payment: false, displays: [], drawerMode: hardwareService.config.drawerMode });
  const [selectedAdjustment, setSelectedAdjustment] = useState(null);
  const [hubState, setHubState] = useState({ enabled: false, online: false, imported: 0, message: '' });

  const refresh = async () => {
    setLoading(true);
    const hubSync = await syncHubOrders();
    const [todayOrders, displays] = await Promise.all([
      loadOrdersInRange(range.start, range.end),
      customerDisplayService.listDisplays().catch(() => []),
    ]);
    setOrders(todayOrders.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)));
    setDeviceState({
      payment: await paxService.ping().then(r => !!r.ok).catch(() => false),
      displays,
      drawerMode: hardwareService.config.drawerMode,
    });
    setHubState(hubSync);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const metrics = useMemo(() => calcOpsMetrics(orders), [orders]);
  const cashVariance = (parseFloat(cashCounted) || 0) - metrics.expectedCash;
  const activeQueue = orders.filter(o => o.status !== 'voided').slice(0, 8);
  const adjustmentOrders = orders.filter(o => o.status !== 'voided').slice(0, 12);

  const applyAdjustment = async ({ type, amount, reason }) => {
    if (!selectedAdjustment) return;
    const num = selectedAdjustment.number || '';
    if (type === 'void') {
      await markOrderVoided(selectedAdjustment.id, reason);
      logActivity('void', `Voided order #${num}${reason ? ' · ' + reason : ''}`, { staff });
    } else {
      await markOrderRefunded(selectedAdjustment.id, amount, reason);
      logActivity('refund', `Refunded ${formatUSD(amount)} on order #${num}${reason ? ' · ' + reason : ''}`,
        { staff, amount: parseFloat(amount) || 0 });
    }
    setSelectedAdjustment(null);
    await refresh();
  };

  const syncHubOrders = async () => {
    return ingestHubOrders(staff?.name || 'POS');
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Vido Food Pro Operations</div>
          <div style={s.subtitle}>Quick-service workflow for drinks, snacks, takeout, delivery, and counter checkout.</div>
        </div>
        <Button variant="ghost" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </Button>
      </div>

      <div style={s.kpiGrid}>
        <Kpi icon={ShoppingBag} label="Orders Today" value={metrics.orders} tone={C.cyan} />
        <Kpi icon={Banknote} label="Net Sales" value={formatUSD(metrics.netSales)} tone={C.primary} />
        <Kpi icon={CreditCard} label="Card Payment" value={formatUSD(metrics.cardSales)} tone={C.blue} />
        <Kpi icon={Archive} label="Expected Cash" value={formatUSD(metrics.expectedCash)} tone={C.yellow} />
      </div>

      <div style={s.layout}>
        <section style={s.mainCol}>
          <Panel title="Live Counter Queue" icon={Activity}>
            {hubState.enabled && (
              <div style={{
                ...s.hubNotice,
                color: hubState.online ? C.green : C.red,
                background: hubState.online ? 'rgba(74,222,128,0.12)' : C.redA,
              }}>
                POS Hub: {hubState.online ? 'Connected' : 'Offline'} · {hubState.message}
              </div>
            )}
            <div style={s.queue}>
              {activeQueue.length === 0 ? (
                <EmptyLine text="No completed tickets today yet." />
              ) : activeQueue.map(o => (
                <div key={o.id} style={s.queueRow}>
                  <div style={s.ticketNo}>#{o.number}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.ticketTitle}>{orderName(o)}</div>
                    <div style={s.ticketMeta}>
                      {formatDateTime(o.completedAt)} · {o.staffName || staff?.name || 'Staff'} · {paymentLabel(o.paymentMethod)}
                    </div>
                  </div>
                  <StatusBadge order={o} />
                  <div style={s.ticketTotal}>{formatUSD(orderTotal(o))}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Refunds and Voids" icon={RotateCcw}>
            <div style={s.adjustList}>
              {adjustmentOrders.length === 0 ? (
                <EmptyLine text="No orders available for adjustment." />
              ) : adjustmentOrders.map(o => (
                <div key={o.id} style={s.adjustRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.adjustTitle}>#{o.number} · {orderName(o)}</div>
                    <div style={s.ticketMeta}>
                      {paymentLabel(o.paymentMethod)} · {formatUSD(orderTotal(o))}
                      {o.refundAmount > 0 && ` · Refunded ${formatUSD(o.refundAmount)}`}
                    </div>
                  </div>
                  <button onClick={() => setSelectedAdjustment(o)} style={s.secondaryAction}>
                    Adjust
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        <aside style={s.sideCol}>
          <Panel title="Closeout" icon={ShieldCheck}>
            <div style={s.closeoutRow}><span>Cash sales</span><strong>{formatUSD(metrics.expectedCash)}</strong></div>
            <div style={s.closeoutRow}><span>Card sales</span><strong>{formatUSD(metrics.cardSales)}</strong></div>
            <div style={s.closeoutRow}><span>Gift card</span><strong>{formatUSD(metrics.giftSales)}</strong></div>
            <div style={s.closeoutRow}><span>Refunds</span><strong style={{ color: C.red }}>-{formatUSD(metrics.refunds)}</strong></div>
            <Field label="Cash Counted">
              <Input value={cashCounted} type="number" step="0.01" onChange={e => setCashCounted(e.target.value)} placeholder="0.00" />
            </Field>
            <div style={{
              ...s.variance,
              color: Math.abs(cashVariance) < 0.01 ? C.green : cashVariance < 0 ? C.red : C.primary,
              background: Math.abs(cashVariance) < 0.01 ? 'rgba(74,222,128,0.12)' : cashVariance < 0 ? C.redA : C.primaryA,
            }}>
              <span>Variance</span><strong>{formatUSD(cashVariance)}</strong>
            </div>
            <textarea
              value={drawerNote}
              onChange={e => setDrawerNote(e.target.value)}
              placeholder="Closeout note..."
              style={s.note}
            />
          </Panel>

          <Panel title="System Readiness" icon={Wifi}>
            <DeviceLine icon={CreditCard} label="Card Payment" ok={deviceState.payment} detail={deviceState.payment ? 'Connected' : 'Needs test'} />
            <DeviceLine icon={Archive} label="Cash Drawer" ok={!!deviceState.drawerMode} detail={deviceState.drawerMode || 'Not configured'} />
            <DeviceLine icon={Printer} label="Receipt Printer" ok={hardwareService.config.receiptMode !== 'disabled'} detail={hardwareService.config.receiptMode || 'USB / ESC-POS'} />
            <DeviceLine icon={Monitor} label="Customer Display" ok={deviceState.displays.some(d => !d.isPrimary)} detail={`${deviceState.displays.length || 1} screen(s)`} />
          </Panel>

          <Panel title="Vido Food Profile" icon={Clock}>
            <ProfileLine label="Business type" value="Quick Service / Food & Drinks" />
            <ProfileLine label="Primary flow" value="Order first, pay at counter" />
            <ProfileLine label="Supported orders" value="Dine in, To go, Delivery" />
            <ProfileLine label="Not enabled" value="Full-service table map" />
          </Panel>
        </aside>
      </div>

      {selectedAdjustment && (
        <AdjustmentModal
          order={selectedAdjustment}
          onClose={() => setSelectedAdjustment(null)}
          onApply={applyAdjustment}
        />
      )}
    </div>
  );
}

function AdjustmentModal({ order, onClose, onApply }) {
  const [type, setType] = useState('refund');
  const [amount, setAmount] = useState(orderTotal(order).toFixed(2));
  const [reason, setReason] = useState('');
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        <div style={s.modalTitle}>Adjust Order #{order.number}</div>
        <div style={s.subtitle}>{orderName(order)} · {formatUSD(orderTotal(order))}</div>
        <div style={s.segment}>
          <button onClick={() => setType('refund')} style={{ ...s.segmentBtn, ...(type === 'refund' ? s.segmentActive : {}) }}>Refund</button>
          <button onClick={() => setType('void')} style={{ ...s.segmentBtn, ...(type === 'void' ? s.segmentActive : {}) }}>Void</button>
        </div>
        {type === 'refund' && (
          <Field label="Refund Amount">
            <Input value={amount} type="number" step="0.01" onChange={e => setAmount(e.target.value)} />
          </Field>
        )}
        <Field label="Reason">
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Customer request, wrong item, duplicate..." />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
          <Button onClick={() => onApply({ type, amount, reason })} style={{ flex: 2 }}>
            Save Adjustment
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section style={s.panel}>
      <div style={s.panelTitle}><Icon size={16} /> {title}</div>
      {children}
    </section>
  );
}

function Kpi({ icon: Icon, label, value, tone }) {
  return (
    <div style={s.kpi}>
      <div style={{ ...s.kpiIcon, color: tone, background: `${tone}22` }}><Icon size={20} /></div>
      <div>
        <div style={s.kpiLabel}>{label}</div>
        <div style={s.kpiValue}>{value}</div>
      </div>
    </div>
  );
}

function DeviceLine({ icon: Icon, label, ok, detail }) {
  return (
    <div style={s.deviceLine}>
      <Icon size={16} color={ok ? C.green : C.red} />
      <div style={{ flex: 1 }}>
        <div style={s.deviceLabel}>{label}</div>
        <div style={s.deviceDetail}>{detail}</div>
      </div>
      {ok ? <CheckCircle2 size={16} color={C.green} /> : <XCircle size={16} color={C.red} />}
    </div>
  );
}

function ProfileLine({ label, value }) {
  return (
    <div style={s.profileLine}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ order }) {
  const refunded = order.refundAmount > 0 || order.status === 'refunded';
  const voided = order.status === 'voided';
  const color = voided ? C.red : refunded ? C.yellow : C.green;
  const text = voided ? 'Void' : refunded ? 'Refunded' : 'Paid';
  return <span style={{ ...s.badge, color, background: `${color}20` }}>{text}</span>;
}

function EmptyLine({ text }) {
  return (
    <div style={s.empty}>
      <FileWarning size={20} color={C.textDim} />
      <span>{text}</span>
    </div>
  );
}

function calcOpsMetrics(orders) {
  return orders.reduce((m, o) => {
    const total = orderTotal(o);
    const refund = o.status === 'voided' ? total : (o.refundAmount || 0);
    const net = Math.max(0, total - refund);
    m.orders += o.status === 'voided' ? 0 : 1;
    m.grossSales += total;
    m.refunds += refund;
    m.netSales += net;
    if (o.paymentMethod === 'cash') m.expectedCash += net;
    else if (o.paymentMethod === 'giftcard') m.giftSales += net;
    else m.cardSales += net;
    return m;
  }, { orders: 0, grossSales: 0, refunds: 0, netSales: 0, cardSales: 0, expectedCash: 0, giftSales: 0 });
}

function orderTotal(order) {
  const subtotal = (order.items || []).reduce((sum, line) => {
    const large = line.size === 'L' ? SHOP.sizeLargeBonus : 0;
    const toppings = (line.toppings || []).reduce((s, t) => s + (t.price || 0), 0);
    return sum + ((line.basePrice || 0) + large + toppings) * (line.qty || 1);
  }, 0);
  return subtotal - (order.discount || 0) + (order.taxAmount || 0) + (order.tip || 0);
}

function orderName(order) {
  const first = order.items?.[0]?.name || 'Order';
  const more = Math.max(0, (order.items?.length || 0) - 1);
  return more ? `${first} + ${more} more` : first;
}

function paymentLabel(method) {
  if (method === 'cash') return 'Cash';
  if (method === 'giftcard') return 'Gift Card';
  return 'Card Payment';
}

const s = {
  container: { padding: 24, color: C.text, flex: 1, overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  title: { fontSize: 24, fontWeight: 900, color: C.text },
  subtitle: { fontSize: 13, color: C.textMute, fontWeight: 700, marginTop: 4 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 12, marginBottom: 14 },
  kpi: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, display: 'flex', alignItems: 'center', gap: 12 },
  kpiIcon: { width: 42, height: 42, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { fontSize: 11, fontWeight: 900, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue: { fontSize: 22, fontWeight: 900, color: C.text, marginTop: 2 },
  layout: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(330px, 0.8fr)', gap: 14 },
  mainCol: { display: 'grid', gap: 14, minWidth: 0 },
  sideCol: { display: 'grid', gap: 14, alignContent: 'start' },
  panel: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 },
  panelTitle: { fontSize: 13, fontWeight: 900, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.45, display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 },
  hubNotice: { borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 900, marginBottom: 10 },
  queue: { display: 'grid', gap: 8 },
  queueRow: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 12 },
  ticketNo: { width: 72, fontSize: 18, fontWeight: 900, color: C.primary },
  ticketTitle: { fontSize: 14, fontWeight: 900, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  ticketMeta: { fontSize: 11, fontWeight: 700, color: C.textMute, marginTop: 3 },
  ticketTotal: { fontSize: 15, fontWeight: 900, color: C.text, minWidth: 82, textAlign: 'right' },
  badge: { borderRadius: 999, padding: '5px 9px', fontSize: 11, fontWeight: 900 },
  adjustList: { display: 'grid', gap: 8 },
  adjustRow: { display: 'flex', alignItems: 'center', gap: 10, background: C.card, borderRadius: 8, padding: 12 },
  adjustTitle: { color: C.text, fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  secondaryAction: { background: C.primaryA, color: C.primary, border: `1px solid ${C.primary}`, borderRadius: 8, padding: '8px 12px', fontWeight: 900, cursor: 'pointer' },
  closeoutRow: { display: 'flex', justifyContent: 'space-between', color: C.text, fontSize: 13, fontWeight: 800, padding: '7px 0', borderBottom: `1px solid ${C.border}` },
  variance: { marginTop: 10, borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', fontWeight: 900 },
  note: { width: '100%', minHeight: 74, marginTop: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, padding: 10, font: 'inherit', fontWeight: 700, boxSizing: 'border-box' },
  deviceLine: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.border}` },
  deviceLabel: { fontSize: 13, fontWeight: 900, color: C.text },
  deviceDetail: { fontSize: 11, fontWeight: 700, color: C.textMute, marginTop: 2 },
  profileLine: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, padding: '8px 0', fontSize: 12, color: C.textMute, fontWeight: 800 },
  empty: { minHeight: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.textMute, fontSize: 13, fontWeight: 800 },
  modalTitle: { fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 4 },
  segment: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '18px 0' },
  segmentBtn: { border: `1px solid ${C.border}`, background: C.card, color: C.text, padding: 12, borderRadius: 8, fontWeight: 900, cursor: 'pointer' },
  segmentActive: { background: C.primary, color: C.bg, borderColor: C.primary },
};

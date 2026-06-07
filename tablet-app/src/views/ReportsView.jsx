import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar, Download, TrendingUp, DollarSign, ShoppingBag, CreditCard,
  Award, Clock, BarChart3, PieChart, Trash2, RefreshCw, ChevronDown, Users,
} from 'lucide-react';
import { C } from '../theme';
import { formatUSD, formatDateTime, SHOP } from '../config';
import { loadOrdersInRange, clearAllOrders, DateRanges } from '../services/orderStorage';
import { loadActivityInRange, clearActivity, ACTIVITY_TYPES } from '../services/activityStorage';
import { Button, Avatar } from '../components/Shared';

export function ReportsView() {
  const [range, setRange] = useState(DateRanges.today());
  const [orders, setOrders] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRangeMenu, setShowRangeMenu] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    const [data, acts] = await Promise.all([
      loadOrdersInRange(range.start, range.end),
      loadActivityInRange(range.start, range.end),
    ]);
    setOrders(data);
    setActivity(acts);
    setLoading(false);
  };

  useEffect(() => { loadOrders(); }, [range]);

  const stats = useMemo(() => calcStats(orders), [orders]);
  const hourly = useMemo(() => calcHourly(orders), [orders]);
  const topItems = useMemo(() => calcTopItems(orders), [orders]);
  const payments = useMemo(() => calcPayments(orders), [orders]);
  const categories = useMemo(() => calcCategories(orders), [orders]);
  const staffPerf = useMemo(() => calcStaffPerf(orders, activity), [orders, activity]);

  const exportCSV = () => {
    const headers = ['Order #', 'Date', 'Time', 'Type', 'Items', 'Subtotal', 'Discount', 'Tax', 'Tip', 'Total', 'Payment', 'Card', 'Staff'];
    const rows = orders.map(o => {
      const sub = (o.items || []).reduce((s, l) => s + (l.basePrice || 0) * (l.qty || 1), 0);
      const total = sub - (o.discount || 0) + (o.taxAmount || 0) + (o.tip || 0);
      return [
        o.number,
        new Date(o.completedAt).toLocaleDateString(),
        new Date(o.completedAt).toLocaleTimeString(),
        o.type,
        o.items?.length || 0,
        sub.toFixed(2),
        (o.discount || 0).toFixed(2),
        (o.taxAmount || 0).toFixed(2),
        (o.tip || 0).toFixed(2),
        total.toFixed(2),
        o.paymentMethod || 'card',
        o.cardLast4 ? `${o.cardType} ${o.cardLast4}` : '',
        o.staffName || '',
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vido-pos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearData = async () => {
    if (confirm('Delete ALL stored orders? This cannot be undone.')) {
      await clearAllOrders();
      await loadOrders();
    }
  };

  const clearActivityData = async () => {
    if (confirm('Delete ALL staff activity history? This cannot be undone.')) {
      await clearActivity();
      await loadOrders();
    }
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Reports</div>
          <div style={s.subtitle}>{range.label}: {orders.length} orders</div>
        </div>
        <div style={s.headerActions}>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowRangeMenu(!showRangeMenu)} style={s.rangeBtn}>
              <Calendar size={14} /> {range.label} <ChevronDown size={14} />
            </button>
            {showRangeMenu && (
              <div style={s.rangeMenu}>
                {[
                  ['today', 'Today'],
                  ['yesterday', 'Yesterday'],
                  ['thisWeek', 'This Week'],
                  ['last7Days', 'Last 7 Days'],
                  ['thisMonth', 'This Month'],
                  ['last30Days', 'Last 30 Days'],
                ].map(([k, label]) => (
                  <button key={k}
                    onClick={() => { setRange(DateRanges[k]()); setShowRangeMenu(false); }}
                    style={s.rangeMenuItem}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={loadOrders} style={s.iconBtn} title="Refresh">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          <button onClick={exportCSV} disabled={!orders.length} style={s.exportBtn}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {!loading && orders.length === 0 && (
        <div style={s.empty}>
          <BarChart3 size={48} color={C.textDim} />
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 14, color: C.text }}>No orders yet</div>
          <div style={{ fontSize: 13, color: C.textMute, marginTop: 6, fontWeight: 700 }}>
            Complete a sale to see it here.
          </div>
        </div>
      )}

      {orders.length > 0 && (
        <>
          <div style={s.statsRow}>
            <StatCard icon={DollarSign} label="Net Sales" value={formatUSD(stats.totalSales)} color={C.primary} />
            <StatCard icon={Award} label="Total Tips" value={formatUSD(stats.totalTips)} color={C.yellow} />
            <StatCard icon={ShoppingBag} label="Orders" value={stats.totalOrders} color={C.cyan} />
            <StatCard icon={TrendingUp} label="Avg Order" value={formatUSD(stats.avgOrder)} color={C.blue} />
          </div>

          <div style={s.taxBox}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Tax Collected ({(SHOP.tax * 100).toFixed(2)}%)
              </span>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{formatUSD(stats.totalTax)}</div>
            </div>
            <div style={{ display: 'flex', gap: 18, textAlign: 'right' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: C.textMute }}>GROSS</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{formatUSD(stats.grossSales)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: C.textMute }}>REFUNDS / VOIDS</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: C.red }}>-{formatUSD(stats.refunds)}</div>
              </div>
            </div>
          </div>

          <div style={s.chartRow}>
            <div style={{ ...s.chartCard, flex: 2 }}>
              <div style={s.chartTitle}><Clock size={14} /> Sales by Hour</div>
              <HourlyChart data={hourly} />
            </div>
            <div style={{ ...s.chartCard, flex: 1 }}>
              <div style={s.chartTitle}><CreditCard size={14} /> Payment Methods</div>
              <PaymentDonut data={payments} />
            </div>
          </div>

          <div style={s.chartRow}>
            <div style={{ ...s.chartCard, flex: 1 }}>
              <div style={s.chartTitle}><PieChart size={14} /> Sales by Category</div>
              <CategoryChart data={categories} />
            </div>
            <div style={{ ...s.chartCard, flex: 1 }}>
              <div style={s.chartTitle}><Award size={14} /> Top Sellers</div>
              <TopItemsChart data={topItems} />
            </div>
          </div>

          <div style={{ ...s.chartCard, marginTop: 14 }}>
            <div style={s.chartTitle}>
              <ShoppingBag size={14} /> Orders ({orders.length})
              <button onClick={clearData} style={s.dangerBtn}>
                <Trash2 size={12} /> Clear
              </button>
            </div>
            <OrderList orders={orders} />
          </div>
        </>
      )}

      {staffPerf.length > 0 && (
        <div style={{ ...s.chartCard, marginTop: 14 }}>
          <div style={s.chartTitle}><Users size={14} /> Staff Performance</div>
          <StaffPerfTable rows={staffPerf} />
        </div>
      )}

      {activity.length > 0 && (
        <div style={{ ...s.chartCard, marginTop: 14 }}>
          <div style={s.chartTitle}>
            <Clock size={14} /> Staff Activity Log ({activity.length})
            <button onClick={clearActivityData} style={s.dangerBtn}>
              <Trash2 size={12} /> Clear
            </button>
          </div>
          <ActivityFeed items={activity} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STAFF PERFORMANCE + ACTIVITY
// ============================================================================
function calcStaffPerf(orders, activity) {
  const map = {};
  const get = (id, name, role, avatar) => {
    if (!map[id]) map[id] = { id, name, role, avatar, orders: 0, sales: 0, tips: 0, discounts: 0, voids: 0, refunds: 0, logins: 0 };
    // keep the most descriptive name/avatar we've seen
    if (name && name !== 'Unknown') map[id].name = name;
    if (role) map[id].role = role;
    if (avatar) map[id].avatar = avatar;
    return map[id];
  };
  for (const o of orders) {
    if (o.status === 'voided') continue;
    const f = orderFinancials(o);
    const r = get(o.staffId || 'unknown', o.staffName, o.role, o.staffAvatar);
    r.orders += 1;
    r.sales += f.net;
    r.tips += f.tip;
  }
  for (const a of activity) {
    const r = get(a.staffId || 'unknown', a.staffName, a.role, a.avatar);
    if (a.type === 'discount') r.discounts += 1;
    else if (a.type === 'void') r.voids += 1;
    else if (a.type === 'refund') r.refunds += 1;
    else if (a.type === 'login') r.logins += 1;
  }
  return Object.values(map).sort((a, b) => b.sales - a.sales);
}

function StaffPerfTable({ rows }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => (
        <div key={r.id} style={perf.row}>
          <Avatar staff={r} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{r.name}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: r.role === 'manager' ? C.primary : C.textMute, textTransform: 'capitalize' }}>
              {r.role || 'staff'} · {r.logins} sign-in{r.logins === 1 ? '' : 's'}
            </div>
          </div>
          <PerfStat label="Orders" value={r.orders} />
          <PerfStat label="Net Sales" value={formatUSD(r.sales)} />
          <PerfStat label="Tips" value={formatUSD(r.tips)} />
          <PerfStat label="Discounts" value={r.discounts} tone={r.discounts ? C.yellow : undefined} />
          <PerfStat label="Void/Refund" value={r.voids + r.refunds} tone={(r.voids + r.refunds) ? C.red : undefined} />
        </div>
      ))}
    </div>
  );
}

function PerfStat({ label, value, tone }) {
  return (
    <div style={{ textAlign: 'right', minWidth: 64 }}>
      <div style={{ fontSize: 14, fontWeight: 900, color: tone || C.text }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
}

const TONE_COLORS = { green: C.green, red: C.red, yellow: C.yellow, blue: C.blue, primary: C.primary, mute: C.textMute };

function ActivityFeed({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360, overflowY: 'auto' }}>
      {items.map(a => {
        const meta = ACTIVITY_TYPES[a.type] || { label: a.type, tone: 'mute' };
        const color = TONE_COLORS[meta.tone] || C.textMute;
        return (
          <div key={a.id} style={perf.actRow}>
            <Avatar staff={{ name: a.staffName, role: a.role, avatar: a.avatar }} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
                <span style={{ color }}>{meta.label}</span>
                {a.detail ? <span style={{ color: C.textMute, fontWeight: 700 }}> — {a.detail}</span> : null}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMute }}>
                {a.staffName}{a.role ? ` · ${a.role}` : ''}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, whiteSpace: 'nowrap' }}>
              {formatDateTime(a.ts)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const perf = {
  row: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: C.card, borderRadius: 12, padding: '10px 14px',
  },
  actRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '9px 4px', borderBottom: `1px solid ${C.border}`,
  },
};

// ============================================================================
// CALCULATIONS
// ============================================================================
function calcStats(orders) {
  let totalSales = 0, grossSales = 0, refunds = 0, totalTips = 0, totalTax = 0, activeOrders = 0;
  for (const o of orders) {
    const f = orderFinancials(o);
    grossSales += f.gross;
    refunds += f.refund;
    if (o.status !== 'voided') {
      activeOrders += 1;
      totalTax += f.tax;
      totalTips += f.tip;
      totalSales += f.net;
    }
  }
  return { totalSales, grossSales, refunds, totalTips, totalTax, totalOrders: activeOrders, avgOrder: activeOrders ? totalSales / activeOrders : 0 };
}

function calcHourly(orders) {
  const hours = new Array(24).fill(0);
  for (const o of orders) {
    if (o.status === 'voided') continue;
    const h = new Date(o.completedAt).getHours();
    hours[h] += orderFinancials(o).net;
  }
  return hours;
}

function calcTopItems(orders) {
  const counts = {};
  for (const o of orders) {
    if (o.status === 'voided') continue;
    for (const l of (o.items || [])) {
      const k = l.name;
      if (!counts[k]) counts[k] = { name: l.name, qty: 0, revenue: 0, emoji: l.emoji };
      counts[k].qty += l.qty;
      counts[k].revenue += lineTotal(l);
    }
  }
  return Object.values(counts).sort((a, b) => b.qty - a.qty).slice(0, 10);
}

function calcPayments(orders) {
  const m = { card: 0, cash: 0, giftcard: 0 };
  for (const o of orders) {
    if (o.status === 'voided') continue;
    const total = orderFinancials(o).net;
    const rawKey = o.paymentMethod || 'card';
    const key = rawKey === 'wallet' ? 'giftcard' : rawKey;
    m[key] = (m[key] || 0) + total;
  }
  return m;
}

function calcCategories(orders) {
  const c = {};
  for (const o of orders) {
    if (o.status === 'voided') continue;
    for (const l of (o.items || [])) {
      const cat = l.category || 'other';
      c[cat] = (c[cat] || 0) + lineTotal(l);
    }
  }
  return c;
}

function lineTotal(line) {
  const large = line.size === 'L' ? SHOP.sizeLargeBonus : 0;
  const toppings = (line.toppings || []).reduce((s, t) => s + (t.price || 0), 0);
  return ((line.basePrice || 0) + large + toppings) * (line.qty || 1);
}

function orderFinancials(order) {
  const sub = (order.items || []).reduce((s, l) => s + lineTotal(l), 0);
  const tax = order.taxAmount || Math.max(0, sub - (order.discount || 0)) * SHOP.tax;
  const tip = order.tip || 0;
  const gross = Math.max(0, sub - (order.discount || 0) + tax + tip);
  const refund = order.status === 'voided' ? gross : Math.min(gross, order.refundAmount || 0);
  const net = Math.max(0, gross - refund);
  return { sub, tax, tip, gross, refund, net };
}

// ============================================================================
// CHART COMPONENTS
// ============================================================================
function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div style={s.statCard}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: `${color}22`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={18} strokeWidth={2.4} />
      </div>
      <div style={{ marginLeft: 12, flex: 1 }}>
        <div style={{ fontSize: 11, color: C.textMute, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

function HourlyChart({ data }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: 140, gap: 2, padding: '8px 0' }}>
      {data.map((v, h) => (
        <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: '100%', height: `${Math.max((v / max) * 100, 2)}%`,
            background: v > 0 ? `linear-gradient(to top, ${C.primary}, ${C.cyan})` : C.border,
            borderRadius: 4, minHeight: 4,
          }} title={`${h}:00 — ${formatUSD(v)}`} />
          <div style={{ fontSize: 9, color: C.textDim, fontWeight: 700 }}>
            {h % 3 === 0 ? `${h}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentDonut({ data }) {
  const total = Object.values(data).reduce((s, v) => s + v, 0);
  if (total === 0) return <Empty />;
  const segs = Object.entries(data).filter(([_, v]) => v > 0);
  const colors = { card: C.primary, cash: C.yellow, giftcard: '#A855F7', wallet: '#A855F7' };
  const labels = { card: 'Card Payment', cash: 'Cash', giftcard: 'Gift Card', wallet: 'Gift Card' };
  let cum = 0;
  const arcs = segs.map(([k, v]) => {
    const pct = (v / total) * 100;
    const start = cum;
    cum += pct;
    return { key: k, value: v, pct, start, color: colors[k] };
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
      <svg width="120" height="120" viewBox="0 0 42 42" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="21" cy="21" r="15.91549" fill="none" stroke={C.card} strokeWidth="6" />
        {arcs.map(a => (
          <circle key={a.key} cx="21" cy="21" r="15.91549"
            fill="none" stroke={a.color} strokeWidth="6"
            strokeDasharray={`${a.pct} ${100 - a.pct}`}
            strokeDashoffset={-a.start} />
        ))}
      </svg>
      <div style={{ marginTop: 12, width: '100%' }}>
        {arcs.map(a => (
          <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: a.color }} />
            <span style={{ flex: 1, color: C.text, fontWeight: 700 }}>{labels[a.key]}</span>
            <span style={{ color: C.textMute, fontWeight: 700 }}>{a.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryChart({ data }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <Empty />;
  const max = Math.max(...entries.map(([, v]) => v));
  const palette = [C.primary, C.cyan, C.yellow, '#A855F7', '#EC4899', '#FB923C'];
  return (
    <div style={{ padding: '8px 0' }}>
      {entries.map(([cat, v], i) => (
        <div key={cat} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
            <span style={{ color: C.text, textTransform: 'capitalize' }}>{cat}</span>
            <span style={{ color: C.textMute }}>{formatUSD(v)}</span>
          </div>
          <div style={{ height: 8, background: C.card, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: palette[i % palette.length], borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopItemsChart({ data }) {
  if (!data.length) return <Empty />;
  const max = data[0].qty;
  return (
    <div style={{ padding: '8px 0' }}>
      {data.slice(0, 8).map((it, i) => (
        <div key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 18 }}>{it.emoji || '🍱'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {it.name}
            </div>
            <div style={{ height: 6, background: C.card, borderRadius: 3, marginTop: 4 }}>
              <div style={{ width: `${(it.qty / max) * 100}%`, height: '100%', background: i === 0 ? C.primary : i === 1 ? C.cyan : i === 2 ? C.yellow : C.border, borderRadius: 3 }} />
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 900, color: C.text, minWidth: 30, textAlign: 'right' }}>×{it.qty}</div>
        </div>
      ))}
    </div>
  );
}

function OrderList({ orders }) {
  return (
    <div style={{ maxHeight: 280, overflowY: 'auto' }}>
      {orders.slice().reverse().map(o => {
        const f = orderFinancials(o);
        return (
          <div key={o.id || o.number} style={s.orderRow}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: C.text, fontSize: 13 }}>
                Order #{o.number} <span style={{ color: C.textMute, fontWeight: 600, fontSize: 11 }}>· {o.type}{o.status === 'voided' ? ' · VOID' : o.refundAmount > 0 ? ' · REFUND' : ''}</span>
              </div>
              <div style={{ fontSize: 11, color: C.textMute, marginTop: 2, fontWeight: 700 }}>
                {formatDateTime(o.completedAt)} · {(o.items || []).length} items
                {o.staffName && ` · ${o.staffName}`}
              </div>
            </div>
            <div style={{ fontWeight: 900, color: o.status === 'voided' ? C.red : C.primary, fontSize: 14 }}>{formatUSD(f.net)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Empty() {
  return <div style={{ padding: 30, textAlign: 'center', color: C.textDim, fontSize: 12, fontWeight: 700 }}>No data</div>;
}

// ============================================================================
const s = {
  container: { padding: 24, color: C.text, flex: 1, overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 22, fontWeight: 900, color: C.text },
  subtitle: { fontSize: 13, color: C.textMute, fontWeight: 700, marginTop: 4 },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },
  rangeBtn: {
    background: C.card, color: C.text, border: 'none',
    padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800,
    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
  },
  rangeMenu: {
    position: 'absolute', top: '100%', right: 0, marginTop: 6,
    background: C.panel, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: 4, minWidth: 180,
    boxShadow: `0 10px 30px ${C.shadow}`, zIndex: 100,
  },
  rangeMenuItem: {
    display: 'block', width: '100%',
    background: 'transparent', color: C.text, border: 'none',
    padding: '8px 12px', fontSize: 13, fontWeight: 700,
    textAlign: 'left', cursor: 'pointer', borderRadius: 6,
  },
  exportBtn: {
    background: C.primary, color: C.bg, border: 'none',
    padding: '8px 14px', borderRadius: 10,
    fontSize: 13, fontWeight: 800,
    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
  },
  iconBtn: {
    background: C.card, color: C.text, border: 'none',
    padding: 8, borderRadius: 10, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dangerBtn: {
    marginLeft: 'auto',
    background: 'transparent', color: C.red, border: 'none',
    padding: '4px 8px', borderRadius: 6,
    fontSize: 11, fontWeight: 800,
    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
  },
  empty: { background: C.panel, borderRadius: 16, padding: 60, textAlign: 'center' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 },
  statCard: { background: C.panel, padding: 16, borderRadius: 14, display: 'flex', alignItems: 'center' },
  taxBox: {
    background: C.panel, padding: 14, borderRadius: 12, marginBottom: 14,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  chartRow: { display: 'flex', gap: 14, flexWrap: 'wrap' },
  chartCard: { background: C.panel, padding: 16, borderRadius: 14, minWidth: 280 },
  chartTitle: {
    fontSize: 12, fontWeight: 800, color: C.textMute,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  orderRow: { display: 'flex', alignItems: 'center', padding: '10px 12px', background: C.card, borderRadius: 10, marginBottom: 6 },
};

import React, { useState, useEffect, useMemo } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { C } from '../theme';
import { formatUSD, formatDateTime, ORDER_TYPES, SHOP } from '../config';
import { loadAllOrders } from '../services/orderStorage';
import { Modal, ModalClose, Input } from '../components/Shared';

export function HistoryView() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    loadAllOrders().then(o => {
      // Sort newest first
      o.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      setOrders(o);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!search) return orders;
    const q = search.toLowerCase();
    return orders.filter(o =>
      String(o.number).includes(q) ||
      o.staffName?.toLowerCase().includes(q) ||
      o.cardLast4?.includes(q) ||
      o.authCode?.toLowerCase().includes(q) ||
      o.note?.toLowerCase().includes(q)
    );
  }, [orders, search]);

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Order History</div>
          <div style={s.subtitle}>{filtered.length} of {orders.length} orders</div>
        </div>
        <div style={s.searchWrap}>
          <Search size={14} color={C.textDim} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by # / staff / card / note..."
            style={s.searchInput}
          />
        </div>
      </div>

      {loading ? (
        <div style={s.empty}>Loading orders...</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          {orders.length === 0 ? 'No orders yet.' : 'No matches.'}
        </div>
      ) : (
        <div style={s.list}>
          {filtered.map(o => {
            const sub = (o.items || []).reduce((s, l) => s + (l.basePrice * l.qty), 0);
            const total = sub - (o.discount || 0) + (o.taxAmount || 0) + (o.tip || 0);
            const t = ORDER_TYPES.find(x => x.id === o.type);
            return (
              <button key={o.id || o.number} onClick={() => setSelected(o)} style={s.row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>
                    {t?.icon} #{o.number} <span style={{ color: C.textMute, fontWeight: 600, fontSize: 12 }}>· {t?.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMute, marginTop: 3, fontWeight: 700 }}>
                    {formatDateTime(o.completedAt)} · {(o.items || []).length} items
                    {o.staffName && ` · ${o.staffName}`}
                    {o.cardLast4 && ` · •••• ${o.cardLast4}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 900, color: C.primary, fontSize: 16 }}>{formatUSD(total)}</div>
                    <div style={{ fontSize: 10, color: C.textMute, fontWeight: 700, marginTop: 2 }}>
                      {o.paymentMethod}
                    </div>
                  </div>
                  <ChevronRight size={16} color={C.textDim} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && <OrderDetailModal order={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ============================================================================
function OrderDetailModal({ order, onClose }) {
  const sub = (order.items || []).reduce((s, l) => s + (l.basePrice * l.qty) + (l.size === 'L' ? SHOP.sizeLargeBonus * l.qty : 0) + (l.toppings || []).reduce((tt, t) => tt + t.price, 0) * l.qty, 0);
  const discount = order.discount || 0;
  const tax = order.taxAmount || (sub - discount) * SHOP.tax;
  const tip = order.tip || 0;
  const total = sub - discount + tax + tip;
  const t = ORDER_TYPES.find(x => x.id === order.type);

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>
          {t?.icon} Order #{order.number}
        </div>
        <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginTop: 4 }}>
          {formatDateTime(order.completedAt)}
          {order.staffName && ` · ${order.staffName}`}
        </div>

        <div style={{ background: C.card, padding: 14, borderRadius: 12, margin: '14px 0' }}>
          {order.items?.map(line => {
            const lineTotal = (line.basePrice + (line.size === 'L' ? SHOP.sizeLargeBonus : 0) + (line.toppings || []).reduce((s, t) => s + t.price, 0)) * line.qty;
            return (
              <div key={line.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: C.text }}>
                  <span>{line.qty}× {line.name}</span>
                  <span>{formatUSD(lineTotal)}</span>
                </div>
                {(line.category !== 'snack' && line.category !== 'topping') && (
                  <div style={{ fontSize: 11, color: C.textMute, marginTop: 2, fontWeight: 700 }}>
                    {line.size === 'L' ? 'Large' : 'Regular'} · {line.sugar}% sugar · {line.ice}% ice
                  </div>
                )}
                {line.toppings?.length > 0 && (
                  <div style={{ fontSize: 11, color: C.primary, marginTop: 2, fontWeight: 700 }}>
                    + {line.toppings.map(t => t.name).join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: '4px 14px' }}>
          <DetailRow label="Subtotal" value={formatUSD(sub)} />
          {discount > 0 && <DetailRow label="Discount" value={`−${formatUSD(discount)}`} color={C.primary} />}
          <DetailRow label="Tax" value={formatUSD(tax)} />
          {tip > 0 && <DetailRow label="Tip" value={formatUSD(tip)} />}
          <div style={{ borderTop: `1px dashed ${C.border}`, marginTop: 8, paddingTop: 8 }}>
            <DetailRow label="TOTAL" value={formatUSD(total)} bold />
          </div>
          {order.cashReceived && <DetailRow label="Cash received" value={formatUSD(order.cashReceived)} />}
          {order.changeGiven > 0 && <DetailRow label="Change" value={formatUSD(order.changeGiven)} />}
          {order.cardLast4 && <DetailRow label="Card" value={`${order.cardType} •••• ${order.cardLast4}`} />}
          {order.authCode && <DetailRow label="Auth" value={order.authCode} />}
          <DetailRow label="Payment" value={(order.paymentMethod || 'card').toUpperCase()} />
        </div>

        {order.note && (
          <div style={{ background: C.card, padding: 12, borderRadius: 10, marginTop: 12, fontSize: 13, fontWeight: 700, color: C.text }}>
            <div style={{ fontSize: 11, color: C.textMute, marginBottom: 4 }}>NOTE</div>
            {order.note}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DetailRow({ label, value, bold, color }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '5px 0',
      fontSize: bold ? 16 : 13,
      fontWeight: bold ? 900 : 700,
      color: color || C.text,
    }}>
      <span style={{ color: bold ? C.text : C.textMute }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ============================================================================
const s = {
  container: { padding: 24, color: C.text, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 14, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: 900, color: C.text },
  subtitle: { fontSize: 13, color: C.textMute, fontWeight: 700, marginTop: 4 },
  searchWrap: {
    background: C.card, padding: '8px 14px', borderRadius: 999,
    display: 'flex', alignItems: 'center', minWidth: 280,
  },
  searchInput: {
    background: 'transparent', border: 'none', outline: 'none',
    color: C.text, fontWeight: 700, fontSize: 13, marginLeft: 8,
    flex: 1, fontFamily: 'inherit',
  },
  empty: {
    background: C.panel, borderRadius: 16, padding: 60,
    textAlign: 'center', color: C.textMute, fontWeight: 700,
  },
  list: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  row: {
    background: C.panel, padding: '12px 16px',
    borderRadius: 12, border: 'none',
    display: 'flex', alignItems: 'center', textAlign: 'left',
    cursor: 'pointer',
  },
};

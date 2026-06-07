import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Minus, Search, Tag, FileText, DollarSign, CreditCard, Smartphone,
  ArrowLeft, X, Check, AlertCircle, RefreshCw, Archive, Settings, Wifi, Store,
} from 'lucide-react';
import { C } from '../theme';
import { SHOP, ORDER_TYPES, formatUSD, formatTime } from '../config';
import { paxService, PAX_STATUS } from '../services/paxBridge';
import { hardwareService } from '../services/hardwareBridge';
import { customerDisplayService } from '../services/customerDisplayBridge';
import { saveOrder, nextOrderNumber } from '../services/orderStorage';
import { logActivity } from '../services/activityStorage';
import { orderHubService } from '../services/orderHubService';
import { Modal, ModalClose, PinLockScreen, Button, Input, Field, BrandMark } from '../components/Shared';
import { useShop } from '../App';

// ============================================================================
// HELPERS
// ============================================================================
function emptyOrder() {
  return {
    id: 'O' + Date.now(),
    number: nextOrderNumber(),
    type: 'togo',
    items: [],
    discount: 0,
    discountType: 'amount',
    note: '',
    createdAt: new Date().toISOString(),
    status: 'open',
  };
}

export function calcLineTotal(line) {
  let p = line.basePrice || 0;
  if (line.size === 'L') p += SHOP.sizeLargeBonus;
  if (line.toppings) p += line.toppings.reduce((s, t) => s + (t.price || 0), 0);
  return p * (line.qty || 1);
}

export function calcOrderTotals(order) {
  const sub = (order.items || []).reduce((s, l) => s + calcLineTotal(l), 0);
  let discount = 0;
  if (order.discount > 0) {
    discount = order.discountType === 'percent' ? sub * (order.discount / 100) : order.discount;
    discount = Math.min(discount, sub);
  }
  const taxable = sub - discount;
  const tax = taxable * SHOP.tax;
  const total = taxable + tax;
  return { sub, discount, taxable, tax, total };
}

// ============================================================================
// MAIN ORDER VIEW
// ============================================================================
export function OrderView({ menu, categories, staff }) {
  const { shop } = useShop();
  const [orders, setOrders] = useState([emptyOrder()]);
  const [activeId, setActiveId] = useState(null);
  const [activeCat, setActiveCat] = useState('all');
  const [search, setSearch] = useState('');
  const [customizing, setCustomizing] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [needsPinFor, setNeedsPinFor] = useState(null);
  const [drawerState, setDrawerState] = useState({ busy: false, message: '' });

  useEffect(() => {
    if (!activeId && orders.length > 0) setActiveId(orders[0].id);
  }, [orders, activeId]);

  const activeOrder = orders.find(o => o.id === activeId) || orders[0];

  useEffect(() => {
    customerDisplayService.autoConfigure().catch(e => {
      console.warn('Customer display auto setup failed:', e);
    });
  }, []);

  useEffect(() => {
    if (!activeOrder) return;
    const totals = calcOrderTotals(activeOrder);
    customerDisplayService
      .update(customerDisplayService.orderPayload(activeOrder, totals, shop))
      .catch(e => console.warn('Customer display update failed:', e));
  }, [activeOrder, shop]);

  const updateOrder = (updates) => {
    setOrders(prev => prev.map(o => o.id === activeId ? { ...o, ...updates } : o));
  };

  const addOrder = () => {
    const o = emptyOrder();
    setOrders(prev => [o, ...prev]);
    setActiveId(o.id);
  };

  const removeOrder = (id) => {
    setOrders(prev => {
      const next = prev.filter(o => o.id !== id);
      return next.length === 0 ? [emptyOrder()] : next;
    });
    if (activeId === id) setActiveId(null);
  };

  const addItem = (line) => {
    updateOrder({ items: [...activeOrder.items, line] });
  };

  const updateLine = (lineId, updates) => {
    updateOrder({
      items: activeOrder.items.map(l =>
        l.id === lineId ? { ...l, ...updates } : l
      ).filter(l => l.qty > 0),
    });
  };

  const onProductClick = (p) => {
    if (!p.available) return;
    if (p.category === 'snack' || p.category === 'topping') {
      addItem({
        id: 'L' + Date.now(),
        productId: p.id, name: p.name, emoji: p.emoji,
        gradient: p.gradient, category: p.category,
        size: 'R', sugar: 100, ice: 100, toppings: [],
        basePrice: p.price, qty: 1,
      });
    } else {
      setCustomizing(p);
    }
  };

  const applyDiscount = (amount, type) => {
    updateOrder({ discount: amount, discountType: type });
    if (amount > 0) {
      const label = type === 'percent' ? `${amount}%` : formatUSD(amount);
      logActivity('discount', `Discount ${label} on order #${activeOrder?.number || ''}`,
        { staff, amount: type === 'percent' ? undefined : amount });
    }
    setDiscountModalOpen(false);
  };

  const onDiscountClick = () => {
    if (staff.role === 'manager') setDiscountModalOpen(true);
    else setNeedsPinFor('discount');
  };

  const openCashDrawer = async () => {
    if (drawerState.busy) return;
    setDrawerState({ busy: true, message: '' });
    try {
      const result = await hardwareService.openCashDrawer();
      setDrawerState({
        busy: false,
        message: result?.simulated ? 'Drawer opened (web preview)' : 'Cash drawer opened',
      });
    } catch (e) {
      setDrawerState({ busy: false, message: e.message || 'Cash drawer failed' });
    }
    setTimeout(() => setDrawerState(prev => ({ ...prev, message: '' })), 3200);
  };

  // Filter menu
  const visibleMenu = menu.filter(m => {
    if (m.isAddon) return false;
    if (activeCat !== 'all' && m.category !== activeCat) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={s.workspace}>
      {/* LEFT: Order tabs */}
      <OrderRail
        orders={orders} activeId={activeId}
        setActiveId={setActiveId} addOrder={addOrder}
      />

      {/* MIDDLE */}
      <div style={s.middle}>
        <div style={s.orderBar}>
          <div style={s.typeToggle}>
            {ORDER_TYPES.map(t => (
              <button key={t.id}
                onClick={() => updateOrder({ type: t.id })}
                style={{
                  ...s.typeBtn,
                  ...(activeOrder?.type === t.id ? s.typeBtnActive : {}),
                }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <div style={s.searchWrap}>
            <Search size={14} color={C.textDim} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search menu..."
              style={s.searchInput}
            />
          </div>
          <div style={s.drawerWrap}>
            <button onClick={openCashDrawer} disabled={drawerState.busy} style={s.drawerBtn}>
              {drawerState.busy ? <RefreshCw size={14} className="spin" /> : <Archive size={14} />}
              <span>{drawerState.busy ? 'Opening...' : 'Open Cash Drawer'}</span>
            </button>
            {drawerState.message && (
              <div style={{
                ...s.drawerToast,
                color: drawerState.message.toLowerCase().includes('failed') ? C.red : C.primary,
                background: drawerState.message.toLowerCase().includes('failed') ? C.redA : C.primaryA,
              }}>
                {drawerState.message}
              </div>
            )}
          </div>
        </div>

        <div style={s.innerRow}>
          {/* Category sidebar */}
          <aside style={s.catRail}>
            <button
              onClick={() => setActiveCat('all')}
              style={{ ...s.catBtn, ...(activeCat === 'all' ? s.catBtnActive : {}) }}>
              <div style={{ fontSize: 22 }}>🍱</div>
              <div style={s.catName}>All</div>
            </button>
            {categories.filter(c => c.id !== 'topping').map(c => (
              <button key={c.id}
                onClick={() => setActiveCat(c.id)}
                style={{ ...s.catBtn, ...(activeCat === c.id ? s.catBtnActive : {}) }}>
                <div style={{ fontSize: 22 }}>{c.icon}</div>
                <div style={s.catName}>{c.name}</div>
              </button>
            ))}
          </aside>

          {/* Product grid */}
          <div style={s.gridWrap}>
            {visibleMenu.length === 0 ? (
              <div style={s.empty}>
                No items{search ? ` matching "${search}"` : ' in this category'}
              </div>
            ) : (
              <div style={s.grid}>
                {visibleMenu.map(p => (
                  <ProductCard key={p.id}
                    product={p}
                    inCart={activeOrder?.items.some(i => i.productId === p.id)}
                    onClick={() => onProductClick(p)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: Cart */}
      <Cart
        order={activeOrder}
        updateLine={updateLine}
        updateOrder={updateOrder}
        onPay={() => {
          const totals = calcOrderTotals(activeOrder);
          customerDisplayService
            .update(customerDisplayService.paymentPayload(activeOrder, totals, 'Payment', shop))
            .catch(e => console.warn('Customer display payment update failed:', e));
          setPaymentOpen(true);
        }}
        onDiscount={onDiscountClick}
        onNote={() => setNoteModalOpen(true)}
      />

      {/* MODALS */}
      {customizing && (
        <CustomizeModal
          product={customizing}
          menu={menu}
          onAdd={(line) => { addItem(line); setCustomizing(null); }}
          onClose={() => setCustomizing(null)}
        />
      )}

      {paymentOpen && (
        <PaymentModal
          order={activeOrder}
          onClose={() => setPaymentOpen(false)}
          onComplete={(payInfo) => {
            const totals = calcOrderTotals(activeOrder);
            const finalOrder = {
              ...activeOrder,
              status: 'complete',
              tip: payInfo.tip || 0,
              taxAmount: totals.tax,
              completedAt: new Date().toISOString(),
              paymentMethod: payInfo.method,
              cardLast4: payInfo.cardLast4,
              cardType: payInfo.cardType,
              authCode: payInfo.authCode,
              paxRefNum: payInfo.paxRefNum,
              paxResponseCode: payInfo.paxResponseCode,
              paxRaw: payInfo.paxRaw,
              cashReceived: payInfo.cashReceived,
              changeGiven: payInfo.changeGiven,
              staffId: staff.id,
              staffName: staff.name,
              items: activeOrder.items.map(line => ({
                ...line,
                category: menu.find(m => m.id === line.productId)?.category || line.category,
              })),
            };
            saveOrder(finalOrder).catch(e => console.warn('Save order failed:', e));
            logActivity('sale', `Order #${finalOrder.number} · ${payInfo.method} · ${formatUSD(totals.total + (payInfo.tip || 0))}`,
              { staff, amount: totals.total + (payInfo.tip || 0) });
            printKitchenTicket(finalOrder).catch(e => console.warn('Kitchen ticket failed:', e));
            customerDisplayService
              .update(customerDisplayService.donePayload({ total: totals.total + (payInfo.tip || 0) }, shop))
              .catch(e => console.warn('Customer display done update failed:', e));
            setPaymentOpen(false);
            setReceiptOrder(finalOrder);
          }}
        />
      )}

      {receiptOrder && (
        <ReceiptModal
          order={receiptOrder}
          onClose={() => {
            removeOrder(receiptOrder.id);
            setReceiptOrder(null);
          }}
        />
      )}

      {discountModalOpen && (
        <DiscountModal
          order={activeOrder}
          onApply={applyDiscount}
          onClose={() => setDiscountModalOpen(false)}
        />
      )}

      {noteModalOpen && (
        <NoteModal
          order={activeOrder}
          onSave={(note) => { updateOrder({ note }); setNoteModalOpen(false); }}
          onClose={() => setNoteModalOpen(false)}
        />
      )}

      {needsPinFor && (
        <PinLockScreen
          title="Manager PIN"
          subtitle={`Required for ${needsPinFor}`}
          managerOnly={true}
          fullScreen={false}
          onUnlock={() => {
            const action = needsPinFor;
            setNeedsPinFor(null);
            if (action === 'discount') setDiscountModalOpen(true);
          }}
          onCancel={() => setNeedsPinFor(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// KIOSK ORDER VIEW — same menu/options as POS, customer-facing checkout
// ============================================================================

/** True when the screen is taller than it is wide (portrait kiosk). */
function useIsPortrait() {
  const get = () => (typeof window !== 'undefined' ? window.innerHeight >= window.innerWidth : false);
  const [portrait, setPortrait] = useState(get);
  useEffect(() => {
    const onResize = () => setPortrait(get());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return portrait;
}

export function KioskOrderView({ menu, categories, staff, onExitKiosk }) {
  const { shop } = useShop();
  const portrait = useIsPortrait();
  const [order, setOrder] = useState(() => ({ ...emptyOrder(), source: 'kiosk' }));
  const [activeCat, setActiveCat] = useState('all');
  const [customizing, setCustomizing] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [doneOrder, setDoneOrder] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminPinOpen, setAdminPinOpen] = useState(false);
  const tapRef = useRef({ count: 0, t: 0 });

  // Hidden admin entry: tap the top-left corner 5x within 3s, then enter the
  // Manager PIN. Customers never see a Settings button.
  const handleSecretTap = () => {
    const now = Date.now();
    const r = tapRef.current;
    if (now - r.t > 3000) r.count = 0;
    r.count += 1;
    r.t = now;
    if (r.count >= 5) { r.count = 0; setAdminPinOpen(true); }
  };

  const visibleMenu = menu.filter(m => {
    if (m.isAddon) return false;
    if (activeCat !== 'all' && m.category !== activeCat) return false;
    return m.available !== false;
  });
  const totals = calcOrderTotals(order);

  useEffect(() => {
    customerDisplayService
      .update(customerDisplayService.orderPayload(order, totals, shop))
      .catch(e => console.warn('Kiosk customer display update failed:', e));
  }, [order, totals.total, shop]);

  const addLine = (line) => {
    setOrder(prev => ({ ...prev, items: [...prev.items, line] }));
  };

  const updateLine = (lineId, updates) => {
    setOrder(prev => ({
      ...prev,
      items: prev.items.map(l => l.id === lineId ? { ...l, ...updates } : l).filter(l => l.qty > 0),
    }));
  };

  const selectProduct = (p) => {
    if (p.category === 'snack' || p.category === 'topping') {
      addLine({
        id: 'L' + Date.now(),
        productId: p.id, name: p.name, emoji: p.emoji,
        gradient: p.gradient, image: p.image, category: p.category,
        size: 'R', sugar: 100, ice: 100, toppings: [],
        basePrice: p.price, qty: 1,
      });
    } else {
      setCustomizing(p);
    }
  };

  const completeKioskOrder = async (payInfo) => {
    const freshTotals = calcOrderTotals(order);
    const localOrder = {
      ...order,
      status: 'complete',
      source: 'kiosk',
      tip: payInfo.tip || 0,
      taxAmount: freshTotals.tax,
      completedAt: new Date().toISOString(),
      paymentMethod: 'card',
      cardLast4: payInfo.cardLast4,
      cardType: payInfo.cardType,
      authCode: payInfo.authCode,
      paxRefNum: payInfo.paxRefNum,
      paxResponseCode: payInfo.paxResponseCode,
      paxRaw: payInfo.paxRaw,
      receiptPhone: payInfo.receiptPhone || '',
      staffId: staff?.id || 'kiosk',
      staffName: staff?.name || 'Kiosk',
      items: order.items.map(line => ({
        ...line,
        category: menu.find(m => m.id === line.productId)?.category || line.category,
      })),
    };

    const hubEnabled = !!orderHubService.config.enabled;
    let finalOrder = localOrder;
    let hubDelivered = false;
    let hubPending = false;

    if (hubEnabled) {
      // Try to send to the POS now; if the POS is briefly offline the order is
      // queued and auto-retried, so a paid order is never lost.
      const submit = await orderHubService.submitOrderReliable(
        { ...localOrder, status: 'paid' },
        { source: 'kiosk' },
      );
      if (submit.ok && submit.order) {
        finalOrder = { ...localOrder, ...submit.order, status: 'complete' };
        hubDelivered = true;
      } else {
        hubPending = true;
      }
    }

    finalOrder = { ...finalOrder, hubDelivered, hubPending };
    await saveOrder(finalOrder);
    logActivity('sale', `Kiosk order #${finalOrder.number || ''} · ${formatUSD(freshTotals.total + (payInfo.tip || 0))}`,
      { staff: staff || { id: 'kiosk', name: 'Kiosk', role: 'kiosk' }, amount: freshTotals.total + (payInfo.tip || 0) });

    // Print the kitchen ticket at the kiosk ONLY when it is running standalone
    // (no POS Hub). When the hub is on, the POS prints the ticket — printing
    // here too would duplicate it.
    if (!hubEnabled) {
      await printKitchenTicket(finalOrder).catch(e => console.warn('Kiosk ticket failed:', e));
    }

    await customerDisplayService
      .update(customerDisplayService.donePayload({ total: freshTotals.total + (payInfo.tip || 0) }, shop))
      .catch(e => console.warn('Kiosk done display failed:', e));
    setDoneOrder(finalOrder);
    setPayOpen(false);
  };

  const resetKiosk = () => {
    setOrder({ ...emptyOrder(), source: 'kiosk' });
    setDoneOrder(null);
    setActiveCat('all');
  };

  if (doneOrder) {
    const deliveryText = doneOrder.hubDelivered
      ? 'Your ticket was sent to the counter.'
      : doneOrder.hubPending
        ? 'Saved — reconnecting to the counter, your ticket will arrive shortly.'
        : 'Your drink ticket was sent to the counter.';
    return (
      <div style={kioskStyles.doneScreen}>
        <div style={kioskStyles.doneCard}>
          <div style={kioskStyles.doneCheck}>✓</div>
          <div style={kioskStyles.doneTitle}>Order received</div>
          <div style={kioskStyles.doneNumber}>#{doneOrder.number}</div>
          <div style={kioskStyles.doneText}>{deliveryText}</div>
          {doneOrder.receiptPhone && <div style={kioskStyles.doneText}>Receipt phone: {doneOrder.receiptPhone}</div>}
          <Button size="lg" onClick={resetKiosk} style={{ marginTop: 24, minWidth: 220 }}>New Order</Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...kioskStyles.screen, ...(portrait ? kioskStyles.screenPortrait : {}) }}>
      {/* Hidden admin hotspot — invisible to customers. 5 taps → Manager PIN. */}
      <div
        onClick={handleSecretTap}
        style={kioskStyles.adminHotspot}
        aria-hidden="true"
      />

      <aside style={{ ...kioskStyles.catBar, ...(portrait ? kioskStyles.catBarPortrait : {}) }}>
        <button onClick={() => setActiveCat('all')}
          style={{ ...kioskStyles.catButton, ...(activeCat === 'all' ? kioskStyles.catActive : {}) }}>
          <span style={kioskStyles.catIcon}>🍱</span>
          <span>All</span>
        </button>
        {categories.filter(c => c.id !== 'topping').map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            style={{ ...kioskStyles.catButton, ...(activeCat === c.id ? kioskStyles.catActive : {}) }}>
            <span style={kioskStyles.catIcon}>{c.icon}</span>
            <span>{c.name}</span>
          </button>
        ))}
      </aside>

      <main style={kioskStyles.menuArea}>
        <div style={kioskStyles.kioskHead}>
          <div>
            <div style={kioskStyles.kioskTitle}>Order Now</div>
            <div style={kioskStyles.kioskSub}>Choose items, customize, add tip, then pay now.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandMark size={52} radius={14} />
          </div>
        </div>
        <div style={kioskStyles.productGrid}>
          {visibleMenu.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProduct(p)}
              style={kioskStyles.productTile}
            >
              <div style={{
                ...kioskStyles.productImage,
                background: p.image ? `url(${p.image}) center/cover` : p.gradient,
              }}>
                {!p.image && <span>{p.emoji}</span>}
              </div>
              <div style={kioskStyles.productInfo}>
                <div style={kioskStyles.productName}>{p.name}</div>
                <div style={kioskStyles.productBottom}>
                  <span style={kioskStyles.productPrice}>{formatUSD(p.price)}</span>
                  <span style={kioskStyles.productAdd}>+ Add</span>
                </div>
              </div>
              {p.popular && <span style={kioskStyles.hotBadge}>HOT</span>}
              {order.items.some(i => i.productId === p.id) && <span style={kioskStyles.inCartBadge}>Added</span>}
            </button>
          ))}
        </div>
      </main>

      <aside style={{ ...kioskStyles.cart, ...(portrait ? kioskStyles.cartPortrait : {}) }}>
        <div style={kioskStyles.cartTitle}>Your Order #{order.number}</div>
        <div style={kioskStyles.cartList}>
          {order.items.length === 0 ? (
            <div style={kioskStyles.emptyCart}>Tap a menu item to start.</div>
          ) : order.items.map(line => (
            <div key={line.id} style={kioskStyles.cartItem}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={kioskStyles.cartName}>{line.name}</div>
                {line.category !== 'snack' && line.category !== 'topping' && (
                  <div style={kioskStyles.cartMods}>
                    {line.size === 'L' ? 'Large' : 'Regular'} · {line.sugar}% sugar · {line.ice}% ice
                  </div>
                )}
                {line.toppings?.length > 0 && (
                  <div style={kioskStyles.cartMods}>+ {line.toppings.map(t => t.name).join(', ')}</div>
                )}
              </div>
              <div style={kioskStyles.qty}>
                <button onClick={() => updateLine(line.id, { qty: line.qty - 1 })}>−</button>
                <span>{line.qty}</span>
                <button onClick={() => updateLine(line.id, { qty: line.qty + 1 })}>+</button>
              </div>
              <div style={kioskStyles.lineTotal}>{formatUSD(calcLineTotal(line))}</div>
            </div>
          ))}
        </div>
        <div style={kioskStyles.totals}>
          <div style={kioskStyles.subRow}><span>Subtotal</span><span>{formatUSD(totals.sub)}</span></div>
          <div style={kioskStyles.subRow}><span>Tax</span><span>{formatUSD(totals.tax)}</span></div>
          <div style={kioskStyles.totalRow}><span>Total</span><span>{formatUSD(totals.total)}</span></div>
          <Button
            size="lg"
            disabled={order.items.length === 0}
            onClick={() => setPayOpen(true)}
            style={{ width: '100%', opacity: order.items.length === 0 ? 0.45 : 1, marginTop: 14 }}
          >
            Pay Now
          </Button>
        </div>
      </aside>

      {customizing && (
        <CustomizeModal
          product={customizing}
          menu={menu}
          onAdd={(line) => { addLine(line); setCustomizing(null); }}
          onClose={() => setCustomizing(null)}
        />
      )}

      {payOpen && (
        <KioskPaymentModal
          order={order}
          onClose={() => setPayOpen(false)}
          onComplete={completeKioskOrder}
        />
      )}

      {adminPinOpen && (
        <PinLockScreen
          managerOnly
          fullScreen={false}
          title="Manager access"
          subtitle="Enter Manager PIN to open kiosk settings"
          onUnlock={() => { setAdminPinOpen(false); setSettingsOpen(true); }}
          onCancel={() => setAdminPinOpen(false)}
        />
      )}

      {settingsOpen && (
        <KioskAdminSettings
          onClose={() => setSettingsOpen(false)}
          onExitKiosk={onExitKiosk}
        />
      )}
    </div>
  );
}

function KioskAdminSettings({ onClose, onExitKiosk }) {
  const normalizeKioskConfig = (next) => ({
    ...next,
    stationId: !next.stationId || next.stationId === 'pos-1' ? 'kiosk-1' : next.stationId,
  });
  const [cfg, setCfg] = useState(() => normalizeKioskConfig({ ...orderHubService.config }));
  const [saved, setSaved] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [hubResult, setHubResult] = useState(null);
  const [terminalResult, setTerminalResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [liveStatus, setLiveStatus] = useState({ state: 'checking', text: 'Checking connection…' });

  useEffect(() => {
    let alive = true;
    orderHubService.ready.then(async () => {
      if (!alive) return;
      const loaded = normalizeKioskConfig({ ...orderHubService.config });
      setCfg(loaded);
      // Auto-check connection on open so staff see status without tapping anything.
      if (loaded.enabled && loaded.hubUrl) {
        const res = await orderHubService.ping(loaded);
        if (alive) setLiveStatus(res.ok
          ? { state: 'ok', text: `Connected to POS (${res.service || 'hub'})` }
          : { state: 'fail', text: `Not connected: ${res.error || 'POS offline'}` });
      } else if (alive) {
        setLiveStatus({ state: 'off', text: 'Not linked to a POS yet' });
      }
    });
    return () => { alive = false; };
  }, []);

  const kioskPax = {
    ...(orderHubService.config.kioskPax || {}),
    ...(cfg.kioskPax || {}),
  };

  const updateKioskPax = (patch) => {
    setCfg(prev => ({
      ...prev,
      kioskPax: { ...(prev.kioskPax || {}), ...patch },
    }));
  };

  const save = async () => {
    setBusy('save');
    const next = await orderHubService.updateConfig(cfg);
    setCfg({ ...next });
    setSaved(true);
    setBusy('');
    setTimeout(() => setSaved(false), 1800);
  };

  const testHub = async () => {
    setBusy('hub');
    await orderHubService.updateConfig(cfg);
    const res = await orderHubService.ping(cfg);
    setHubResult(res);
    setBusy('');
  };

  // One-tap: turn on the hub link, save, and check it — the simple path.
  const connectHub = async () => {
    setBusy('hub');
    const next = { ...cfg, enabled: true };
    setCfg(next);
    await orderHubService.updateConfig(next);
    const res = await orderHubService.ping(next);
    setHubResult(res);
    setLiveStatus(res.ok
      ? { state: 'ok', text: `Connected to POS (${res.service || 'hub'})` }
      : { state: 'fail', text: `Not connected: ${res.error || 'POS offline'}` });
    setBusy('');
  };

  const testTerminal = async () => {
    setBusy('terminal');
    setTerminalResult(null);
    const oldPax = { ...paxService.config };
    try {
      await orderHubService.updateConfig(cfg);
      await paxService.updateConfig({
        ...oldPax,
        connectionMode: kioskPax.connectionMode || 'tcp',
        terminalSerial: kioskPax.terminalSerial || '',
        ip: kioskPax.ip || '',
        port: Number(kioskPax.port || 10009),
        timeout: Number(kioskPax.timeout || 60000),
        tipRequest: kioskPax.tipRequest !== false,
        usePosLinkSdk: kioskPax.usePosLinkSdk !== false,
      });
      setTerminalResult(await paxService.ping());
    } catch (e) {
      setTerminalResult({ ok: false, error: e.message || 'Terminal test failed' });
    } finally {
      await paxService.updateConfig(oldPax);
      setBusy('');
    }
  };

  const statusColor = liveStatus.state === 'ok' ? C.green
    : liveStatus.state === 'fail' ? C.red : C.textMute;
  const statusBg = liveStatus.state === 'ok' ? 'rgba(74,222,128,0.12)'
    : liveStatus.state === 'fail' ? C.redA : C.card;

  return (
    <Modal onClose={onClose} maxWidth={620}>
      <div style={{ padding: 26 }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 26, fontWeight: 900, color: C.text }}>Kiosk Setup</div>
        <div style={{ fontSize: 13, color: C.textMute, fontWeight: 800, marginTop: 6, marginBottom: 16 }}>
          Two things to set: the POS to send orders to, and the card terminal.
        </div>

        {/* LIVE STATUS BANNER */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px', borderRadius: 12, marginBottom: 18,
          background: statusBg, color: statusColor, fontWeight: 800, fontSize: 14,
        }}>
          {liveStatus.state === 'checking'
            ? <RefreshCw size={16} className="spin" />
            : liveStatus.state === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
          {liveStatus.text}
        </div>

        {/* STEP 1 — POS */}
        <div style={kioskStyles.settingsPanel}>
          <div style={kioskStyles.settingsTitle}>1 · Connect to POS</div>
          <Field label="POS address" hint="The POS device's Wi-Fi IP, then :8787 — e.g. http://192.168.1.50:8787">
            <Input
              value={cfg.hubUrl || ''}
              placeholder="http://192.168.1.50:8787"
              onChange={e => setCfg({ ...cfg, hubUrl: e.target.value })}
            />
          </Field>
          <Button onClick={connectHub} disabled={busy === 'hub' || !cfg.hubUrl} style={{ width: '100%' }}>
            {busy === 'hub'
              ? <><RefreshCw size={16} className="spin" /> Connecting…</>
              : <><Wifi size={16} /> Connect &amp; Test</>}
          </Button>
        </div>

        {/* STEP 2 — TERMINAL */}
        <div style={kioskStyles.settingsPanel}>
          <div style={kioskStyles.settingsTitle}>2 · Card terminal</div>
          {(kioskPax.connectionMode || 'tcp') === 'tcp' ? (
            <Field label="Terminal IP" hint="Shown on the PAX/BroadPOS screen">
              <Input
                value={kioskPax.ip || ''}
                placeholder="192.168.1.59"
                onChange={e => updateKioskPax({ ip: e.target.value })}
              />
            </Field>
          ) : (
            <div style={kioskStyles.settingsNote}>
              {(kioskPax.connectionMode || 'tcp') === 'usb'
                ? 'USB mode: plug the PAX terminal into this kiosk by USB and allow the Android permission.'
                : 'Serial mode: terminal is paired by serial number (set under Advanced).'}
            </div>
          )}
          <Button variant="ghost" onClick={testTerminal} disabled={busy === 'terminal' || kioskPax.enabled === false} style={{ width: '100%' }}>
            {busy === 'terminal' ? <><RefreshCw size={16} className="spin" /> Testing…</> : <><CreditCard size={16} /> Test terminal</>}
          </Button>
        </div>

        {hubResult && !hubResult.ok && (
          <div style={{ ...kioskStyles.resultBox, color: C.red, background: C.redA }}>
            POS not reachable: {hubResult.error}. Check that the POS app is open and on the same Wi-Fi.
          </div>
        )}
        {terminalResult && (
          <div style={{ ...kioskStyles.resultBox, color: terminalResult.ok ? C.green : C.red, background: terminalResult.ok ? 'rgba(74,222,128,0.12)' : C.redA }}>
            {terminalResult.ok ? `Terminal connected${terminalResult.web ? ' (web preview simulated)' : ''}` : `Terminal failed: ${terminalResult.error}`}
          </div>
        )}

        {/* ADVANCED (hidden by default) */}
        <button type="button" onClick={() => setAdvanced(a => !a)} style={kioskStyles.advancedToggle}>
          <Settings size={14} /> {advanced ? 'Hide advanced' : 'Advanced settings'}
        </button>

        {advanced && (
          <>
            <div style={kioskStyles.settingsPanel}>
              <div style={kioskStyles.settingsTitle}>POS Hub — advanced</div>
              <label style={kioskStyles.settingCheck}>
                <input type="checkbox" checked={!!cfg.enabled}
                  onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
                Send orders to POS Hub
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Store ID" hint="Must match the POS">
                  <Input value={cfg.storeId || ''} placeholder="vido-food"
                    onChange={e => setCfg({ ...cfg, storeId: e.target.value })} />
                </Field>
                <Field label="This Kiosk ID">
                  <Input value={cfg.stationId || ''} placeholder="kiosk-1"
                    onChange={e => setCfg({ ...cfg, stationId: e.target.value })} />
                </Field>
              </div>
            </div>

            <div style={kioskStyles.settingsPanel}>
              <div style={kioskStyles.settingsTitle}>Card terminal — advanced</div>
              <label style={kioskStyles.settingCheck}>
                <input type="checkbox" checked={kioskPax.enabled !== false}
                  onChange={e => updateKioskPax({ enabled: e.target.checked })} />
                Use a separate PAX terminal for Pay Now
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Connection">
                  <select value={kioskPax.connectionMode || 'tcp'}
                    onChange={e => updateKioskPax({ connectionMode: e.target.value })}
                    style={kioskStyles.settingsSelect}>
                    <option value="tcp">TCP/IP</option>
                    <option value="usb">USB via POSLink SDK</option>
                    <option value="serial">Serial number</option>
                  </select>
                </Field>
                <Field label="Port" hint="BroadPOS default 10009">
                  <Input type="number" value={kioskPax.port || 10009}
                    disabled={(kioskPax.connectionMode || 'tcp') !== 'tcp'}
                    onChange={e => updateKioskPax({ port: Number(e.target.value || 10009) })} />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Timeout (ms)" hint="60000 = 60s">
                  <Input type="number" value={kioskPax.timeout || 60000}
                    onChange={e => updateKioskPax({ timeout: Number(e.target.value || 60000) })} />
                </Field>
                <Field label="Terminal serial" hint="Optional">
                  <Input value={kioskPax.terminalSerial || ''} placeholder="Optional"
                    onChange={e => updateKioskPax({ terminalSerial: e.target.value })} />
                </Field>
              </div>
              <label style={kioskStyles.settingCheck}>
                <input type="checkbox" checked={kioskPax.tipRequest !== false}
                  onChange={e => updateKioskPax({ tipRequest: e.target.checked })} />
                Show tip on PAX terminal
              </label>
              <label style={kioskStyles.settingCheck}>
                <input type="checkbox" checked={kioskPax.usePosLinkSdk !== false}
                  onChange={e => updateKioskPax({ usePosLinkSdk: e.target.checked })} />
                Use PAX POSLink SDK in Android build
              </label>
            </div>
          </>
        )}

        <Button onClick={save} disabled={busy === 'save'} style={{ width: '100%', marginTop: 4 }}>
          {saved ? <><Check size={16} /> Saved</> : 'Save'}
        </Button>

        {/* DEVICE MODE — turn this tablet back into a full POS terminal. */}
        {onExitKiosk && (
          <div style={{ ...kioskStyles.settingsPanel, marginTop: 18, borderColor: C.border }}>
            <div style={kioskStyles.settingsTitle}>Device mode</div>
            <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginBottom: 12 }}>
              This tablet is running in <b>Kiosk</b> mode. Switch it back to a full
              POS terminal (cashier sign-in, reports, settings).
            </div>
            {!exitConfirm ? (
              <Button variant="ghost" onClick={() => setExitConfirm(true)} style={{ width: '100%' }}>
                <Store size={16} /> Switch to POS mode
              </Button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" onClick={() => setExitConfirm(false)} style={{ flex: 1 }}>
                  Cancel
                </Button>
                <Button onClick={() => onExitKiosk()} style={{ flex: 1 }}>
                  <Store size={16} /> Confirm
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============================================================================
// ORDER RAIL (left sidebar)
// ============================================================================
function OrderRail({ orders, activeId, setActiveId, addOrder }) {
  return (
    <aside style={s.orderRail}>
      <div style={s.railHead}>
        <span>ORDERS</span>
        <button onClick={addOrder} style={s.railAdd} title="New order">
          <Plus size={14} strokeWidth={3} />
        </button>
      </div>
      <div style={{ padding: 10, overflowY: 'auto' }}>
        {orders.map(o => {
          const t = ORDER_TYPES.find(x => x.id === o.type);
          const totals = calcOrderTotals(o);
          const active = o.id === activeId;
          return (
            <button key={o.id} onClick={() => setActiveId(o.id)}
              style={{ ...s.railItem, ...(active ? s.railItemActive : {}) }}>
              <div style={s.railItemNo}>{t?.icon} #{o.number}</div>
              <div style={s.railItemMeta}>{o.items.length} items</div>
              <div style={s.railItemPrice}>{formatUSD(totals.total)}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ============================================================================
// PRODUCT CARD
// ============================================================================
function ProductCard({ product, inCart, onClick }) {
  const isSoldOut = !product.available;
  return (
    <button
      onClick={onClick}
      disabled={isSoldOut}
      style={{
      ...s.product,
      opacity: isSoldOut ? 0.4 : 1,
      cursor: isSoldOut ? 'not-allowed' : 'pointer',
    }}>
      <div style={{
        ...s.productImg,
        background: product.image ? `url(${product.image}) center/cover` : product.gradient,
      }}>
        {!product.image && <span>{product.emoji}</span>}
      </div>
      <div style={s.productBody}>
        <div style={s.productName}>{product.name}</div>
        <div style={s.productFooter}>
          <div style={s.productPrice}>{formatUSD(product.price)}</div>
          <div style={s.productAdd}>+ Add</div>
        </div>
      </div>
      {product.popular && <div style={s.popular}>★ HOT</div>}
      {inCart && <div style={s.addedBadge}>✓ Added</div>}
      {isSoldOut && <div style={s.soldOut}>SOLD OUT</div>}
    </button>
  );
}

// ============================================================================
// CART (right side)
// ============================================================================
function Cart({ order, updateLine, updateOrder, onPay, onDiscount, onNote }) {
  if (!order) return null;
  const totals = calcOrderTotals(order);

  return (
    <aside style={s.cart}>
      <div style={s.cartHead}>
        <span>🛍️ Order #{order.number}</span>
        <span style={s.cartHeadDate}>{formatTime(order.createdAt)}</span>
      </div>

      <div style={s.cartMeta}>
        <div style={s.dashedBtn}>👥 Add rewards member</div>
      </div>

      <div style={s.cartList}>
        {order.items.length === 0 ? (
          <div style={s.cartEmpty}>
            No items yet.<br />Tap a drink to add it.
          </div>
        ) : order.items.map(line => (
          <div key={line.id} style={s.cartItem}>
            <div style={{
              ...s.cartImg,
              background: line.image ? `url(${line.image}) center/cover` : line.gradient,
            }}>
              {!line.image && <span>{line.emoji}</span>}
            </div>
            <div style={s.cartBody}>
              <div style={s.cartName}>{line.name}</div>
              {(line.category !== 'snack' && line.category !== 'topping') && (
                <div style={s.cartMetaLine}>
                  {line.size === 'L' ? 'Large' : 'Regular'} · {line.sugar}% sugar · {line.ice}% ice
                </div>
              )}
              {line.toppings?.length > 0 && (
                <div style={s.cartTops}>+ {line.toppings.map(t => t.name).join(', ')}</div>
              )}
              <div style={s.cartRow}>
                <div style={s.qtyBox}>
                  <button onClick={() => updateLine(line.id, { qty: line.qty - 1 })} style={s.qtyBtn}>−</button>
                  <span style={s.qtyNum}>{line.qty}</span>
                  <button onClick={() => updateLine(line.id, { qty: line.qty + 1 })} style={s.qtyBtn}>+</button>
                </div>
                <div style={s.cartPrice}>{formatUSD(calcLineTotal(line))}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={s.cartFoot}>
        <div style={s.chipRow}>
          <button onClick={onDiscount} style={{
            ...s.chip,
            ...(order.discount > 0 ? { background: C.primary, color: C.bg } : {}),
          }}>
            🏷️ {order.discount > 0
              ? (order.discountType === 'percent' ? `${order.discount}% off` : `-${formatUSD(order.discount)}`)
              : 'Discount'}
          </button>
          <button onClick={onNote} style={{
            ...s.chip,
            ...(order.note ? { background: C.cyan, color: C.bg } : {}),
          }}>
            📝 {order.note ? 'Note ✓' : 'Note'}
          </button>
        </div>

        <div style={s.totals}>
          <div style={s.subRow}><span>Subtotal</span><span style={{ color: C.text }}>{formatUSD(totals.sub)}</span></div>
          {totals.discount > 0 && (
            <div style={s.subRow}><span>Discount</span><span style={{ color: C.primary }}>−{formatUSD(totals.discount)}</span></div>
          )}
          <div style={s.subRow}><span>Tax ({(SHOP.tax * 100).toFixed(2)}%)</span><span style={{ color: C.text }}>{formatUSD(totals.tax)}</span></div>
          <div style={s.totalRow}>
            <span>Total</span>
            <span style={s.totalAmt}>{formatUSD(totals.total)}</span>
          </div>
          <div style={s.tipHint}>✨ Customer adds tip on card terminal</div>
        </div>

        <div style={s.payRow}>
          <button
            onClick={onPay}
            disabled={order.items.length === 0}
            style={{
              ...s.payBtn,
              opacity: order.items.length === 0 ? 0.4 : 1,
              cursor: order.items.length === 0 ? 'not-allowed' : 'pointer',
            }}>
            💳 Pay {formatUSD(totals.total)} →
          </button>
        </div>
      </div>
    </aside>
  );
}

// ============================================================================
// CUSTOMIZE MODAL
// ============================================================================
function CustomizeModal({ product, menu, onAdd, onClose }) {
  const [size, setSize] = useState('R');
  const [sugar, setSugar] = useState(100);
  const [ice, setIce] = useState(100);
  const [toppings, setToppings] = useState([]);

  const addons = menu.filter(m => m.isAddon && m.available);
  const sizePrice = size === 'L' ? SHOP.sizeLargeBonus : 0;
  const toppingsPrice = toppings.reduce((s, t) => s + t.price, 0);
  const totalPrice = product.price + sizePrice + toppingsPrice;

  const toggleTopping = (t) => {
    setToppings(prev =>
      prev.find(x => x.id === t.id)
        ? prev.filter(x => x.id !== t.id)
        : [...prev, t]
    );
  };

  return (
    <Modal onClose={onClose}>
      <div style={{
        height: 140,
        background: product.image ? `url(${product.image}) center/cover` : product.gradient,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {!product.image && <span style={{ fontSize: 80 }}>{product.emoji}</span>}
      </div>
      <div style={{ padding: '18px 22px' }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{product.name}</div>
        <div style={{ fontSize: 13, color: C.textMute, marginTop: 4, fontWeight: 700 }}>
          Base: {formatUSD(product.price)}
        </div>

        <SectionLabel>SIZE</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <SegBtn active={size === 'R'} onClick={() => setSize('R')}>Regular</SegBtn>
          <SegBtn active={size === 'L'} onClick={() => setSize('L')}>
            Large <span style={{ fontSize: 10, opacity: 0.85 }}>+{formatUSD(SHOP.sizeLargeBonus)}</span>
          </SegBtn>
        </div>

        <SectionLabel>SUGAR</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 25, 50, 75, 100].map(p => (
            <SegBtn key={p} small active={sugar === p} onClick={() => setSugar(p)}>{p}%</SegBtn>
          ))}
        </div>

        <SectionLabel>ICE</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 25, 50, 75, 100].map(p => (
            <SegBtn key={p} small active={ice === p} onClick={() => setIce(p)}>{p}%</SegBtn>
          ))}
        </div>

        {addons.length > 0 && (
          <>
            <SectionLabel>ADD TOPPINGS</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {addons.map(t => {
                const active = toppings.find(x => x.id === t.id);
                return (
                  <button key={t.id} onClick={() => toggleTopping(t)} style={{
                    width: 'calc(33.33% - 4px)',
                    background: active ? C.cyan : C.card,
                    color: active ? C.bg : C.text,
                    padding: 10, borderRadius: 12,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    boxShadow: active ? `0 3px 0 ${C.cyanD}` : 'none',
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 12 }}>{t.name}</div>
                    <div style={{ fontSize: 10, opacity: 0.85, fontWeight: 700, marginTop: 2 }}>
                      +{formatUSD(t.price)}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div style={s.modalFooter}>
        <div>
          <div style={{ fontSize: 12, color: C.textMute }}>Item total</div>
          <div style={{ fontSize: 26, color: C.primary, fontWeight: 900 }}>{formatUSD(totalPrice)}</div>
        </div>
        <Button size="lg" onClick={() => onAdd({
          id: 'L' + Date.now(),
          productId: product.id, name: product.name, emoji: product.emoji,
          gradient: product.gradient, category: product.category,
          size, sugar, ice, toppings,
          basePrice: product.price, qty: 1,
        })}>
          Add to Order
        </Button>
      </div>
    </Modal>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 1, marginTop: 18, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function SegBtn({ active, onClick, children, small }) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      background: active ? C.primary : C.card,
      color: active ? C.bg : C.text,
      padding: small ? '8px 4px' : '12px 6px',
      borderRadius: 10, fontWeight: 800,
      fontSize: small ? 12 : 14, border: 'none',
      boxShadow: active ? `0 3px 0 ${C.primaryD}` : 'none',
      cursor: 'pointer',
    }}>
      {children}
    </button>
  );
}

// ============================================================================
// DISCOUNT MODAL
// ============================================================================
function DiscountModal({ order, onApply, onClose }) {
  const [type, setType] = useState('amount');
  const [value, setValue] = useState('');

  const apply = () => {
    const v = parseFloat(value) || 0;
    onApply(v, type);
  };

  return (
    <Modal onClose={onClose} maxWidth={420}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 14 }}>
          🏷️ Apply Discount
        </div>

        <div style={{ display: 'flex', gap: 6, background: C.card, padding: 4, borderRadius: 10, marginBottom: 14 }}>
          <SegBtn active={type === 'amount'} onClick={() => setType('amount')}>$ Amount</SegBtn>
          <SegBtn active={type === 'percent'} onClick={() => setType('percent')}>% Percent</SegBtn>
        </div>

        <Field label={type === 'amount' ? 'Discount Amount ($)' : 'Discount Percentage (%)'}>
          <Input
            type="number"
            step={type === 'amount' ? '0.25' : '1'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={type === 'amount' ? '0.00' : '10'}
            autoFocus
          />
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button variant="ghost" onClick={() => onApply(0, 'amount')} style={{ flex: 1 }}>Remove</Button>
          <Button onClick={apply} style={{ flex: 2 }}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// NOTE MODAL
// ============================================================================
function NoteModal({ order, onSave, onClose }) {
  const [note, setNote] = useState(order.note || '');
  return (
    <Modal onClose={onClose} maxWidth={420}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 14 }}>
          📝 Order Note
        </div>
        <Field label="Note (visible on receipt)">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g., No straw, customer allergic to dairy..."
            autoFocus
            rows={4}
            style={{
              width: '100%', padding: '10px 14px',
              background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              outline: 'none', resize: 'vertical',
            }}
          />
        </Field>
        <Button onClick={() => onSave(note)} style={{ width: '100%' }}>Save Note</Button>
      </div>
    </Modal>
  );
}

// ============================================================================
// PAYMENT MODAL — handles cash / card / gift card
// ============================================================================
function PaymentModal({ order, onClose, onComplete }) {
  const [method, setMethod] = useState(null);
  const totals = calcOrderTotals(order);

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        {!method ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>Payment</div>
            <div style={{ fontSize: 13, color: C.textMute, marginTop: 4, fontWeight: 700 }}>
              Order #{order.number}
            </div>
            <div style={s.payTotalBox}>
              <span style={{ fontWeight: 800 }}>Total due</span>
              <span style={{ fontSize: 28, color: C.primary, fontWeight: 900 }}>{formatUSD(totals.total)}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <PayCard icon={DollarSign} label="Cash" onClick={() => setMethod('cash')} />
              <PayCard icon={CreditCard} label="Card Payment" highlight onClick={() => setMethod('card')} />
              <PayCard icon={Smartphone} label="Gift Card" onClick={() => setMethod('giftcard')} />
            </div>
          </>
        ) : method === 'card' ? (
          <PaxFlow order={order} onBack={() => setMethod(null)} onDone={onComplete} />
        ) : method === 'cash' ? (
          <CashFlow order={order} onBack={() => setMethod(null)} onDone={onComplete} />
        ) : (
          <GiftCardFlow order={order} onBack={() => setMethod(null)} onDone={onComplete} />
        )}
      </div>
    </Modal>
  );
}

function KioskPaymentModal({ order, onClose, onComplete }) {
  const { shop } = useShop();
  const totals = calcOrderTotals(order);
  const tipPercents = shop.tipPercents || [15, 18, 20, 25];
  const [tip, setTip] = useState(0);
  const [customTip, setCustomTip] = useState('');
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState(PAX_STATUS.IDLE);
  const [result, setResult] = useState(null);
  const [receiptPhone, setReceiptPhone] = useState('');
  const [finishing, setFinishing] = useState(false);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await onComplete({
        method: 'card',
        tip: tipAmount,
        receiptPhone,
        cardLast4: result.cardLast4,
        cardType: result.cardType,
        authCode: result.authCode,
        paxRefNum: result.refNum,
        paxResponseCode: result.responseCode,
        paxRaw: result.raw,
      });
    } catch (e) {
      console.warn('Kiosk finish failed:', e);
      setFinishing(false);
    }
  };

  const tipAmount = customTip !== '' ? (parseFloat(customTip) || 0) : tip;
  const totalWithTip = totals.total + tipAmount;

  useEffect(() => {
    const unsub = paxService.onUpdate(txn => {
      if (!txn) return;
      setStatus(txn.status);
      if (['approved', 'declined', 'cancelled', 'timeout', 'error'].includes(txn.status.id)) {
        setResult(txn);
      }
    });
    return () => { unsub(); };
  }, []);

  const startPayment = async () => {
    setStarted(true);
    setResult(null);
    setStatus(PAX_STATUS.SENDING);
    const oldPax = { ...paxService.config };
    try {
      await orderHubService.ready;
      const kioskPax = orderHubService.config.kioskPax || {};
      if (kioskPax.enabled !== false) {
        await paxService.updateConfig({
          ...oldPax,
          connectionMode: kioskPax.connectionMode || 'tcp',
          terminalSerial: kioskPax.terminalSerial || '',
          ip: kioskPax.ip || '',
          port: Number(kioskPax.port || 10009),
          timeout: Number(kioskPax.timeout || 60000),
          tipRequest: kioskPax.tipRequest !== false,
          usePosLinkSdk: kioskPax.usePosLinkSdk !== false,
        });
      }
      await paxService.sale(totalWithTip, `K${order.number}`);
    } catch (e) {
      setResult({ status: PAX_STATUS.ERROR, error: e.message });
      setStatus(PAX_STATUS.ERROR);
    } finally {
      await paxService.updateConfig(oldPax);
    }
  };

  const approved = result?.status?.id === 'approved';

  return (
    <Modal onClose={approved ? () => {} : onClose} maxWidth={620}>
      <div style={{ padding: 26 }}>
        {!approved && <ModalClose onClose={onClose} />}
        <div style={{ fontSize: 24, fontWeight: 900, color: C.text }}>Pay Now</div>
        <div style={{ fontSize: 13, color: C.textMute, marginTop: 4, fontWeight: 800 }}>
          Order #{order.number}
        </div>
        <div style={s.payTotalBox}>
          <span style={{ fontWeight: 800 }}>Order total</span>
          <span style={{ fontSize: 30, color: C.primary, fontWeight: 900 }}>{formatUSD(totals.total)}</span>
        </div>

        {!started && (
          <>
            <SectionLabel>Add tip</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {tipPercents.map(p => {
                const amount = Math.round(totals.total * (p / 100) * 100) / 100;
                const active = customTip === '' && tip === amount;
                return (
                  <button key={p} onClick={() => { setCustomTip(''); setTip(amount); }}
                    style={{ ...kioskStyles.tipButton, ...(active ? kioskStyles.tipActive : {}) }}>
                    <strong>{p}%</strong>
                    <span>{formatUSD(amount)}</span>
                  </button>
                );
              })}
            </div>
            <Field label="Custom tip amount">
              <Input
                value={customTip}
                type="number"
                step="0.01"
                placeholder="0.00"
                onChange={e => { setCustomTip(e.target.value); setTip(0); }}
                style={{ fontSize: 22, textAlign: 'right' }}
              />
            </Field>
            <div style={kioskStyles.paySummary}>
              <span>Total with tip</span>
              <strong>{formatUSD(totalWithTip)}</strong>
            </div>
            <Button size="lg" onClick={startPayment} style={{ width: '100%', marginTop: 12 }}>
              Send to Terminal
            </Button>
          </>
        )}

        {started && !approved && (
          <>
            <PaxStatusCard status={status} />
            {result && result.status?.id !== 'approved' && (
              <div style={s.declineBox}>
                <AlertCircle size={20} />
                <div>
                  <div style={{ fontWeight: 900 }}>{result.status?.label || 'Payment failed'}</div>
                  <div style={{ fontSize: 12 }}>{result.error || result.declineReason || 'Please try again.'}</div>
                </div>
              </div>
            )}
            {result && result.status?.id !== 'approved' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="ghost" onClick={() => { setStarted(false); setResult(null); }} style={{ flex: 1 }}>Back</Button>
                <Button onClick={startPayment} style={{ flex: 1 }}>Try Again</Button>
              </div>
            )}
          </>
        )}

        {approved && (
          <>
            <div style={kioskStyles.approvedBox}>
              <div style={{ fontSize: 34, fontWeight: 900 }}>✓</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Payment approved</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.textMute }}>
                  {result.cardType || 'Card'} •••• {result.cardLast4 || '----'} · {formatUSD(totalWithTip)}
                </div>
              </div>
            </div>
            <Field label="Phone for receipt (optional)">
              <Input
                value={receiptPhone}
                inputMode="tel"
                placeholder="Customer phone number"
                onChange={e => setReceiptPhone(e.target.value)}
              />
            </Field>
            <Button onClick={finish} disabled={finishing} style={{ width: '100%' }}>
              {finishing ? 'Sending…' : 'Show Order Number'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function PayCard({ icon: Icon, label, highlight, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      background: highlight ? C.primary : C.card,
      color: highlight ? C.bg : C.text,
      padding: 18, borderRadius: 14, border: 'none',
      boxShadow: highlight ? `0 4px 0 ${C.primaryD}` : 'none',
      cursor: 'pointer',
    }}>
      <Icon size={28} strokeWidth={2} />
      <div style={{ fontWeight: 800, fontSize: 13, marginTop: 8 }}>{label}</div>
    </button>
  );
}

// === CASH FLOW ===
function CashFlow({ order, onBack, onDone }) {
  const totals = calcOrderTotals(order);
  const [received, setReceived] = useState('');
  const recvNum = parseFloat(received) || 0;
  const change = Math.max(0, recvNum - totals.total);
  const sufficient = recvNum >= totals.total;

  const quickAmounts = [
    Math.ceil(totals.total),
    Math.ceil(totals.total / 5) * 5,
    Math.ceil(totals.total / 10) * 10,
    Math.ceil(totals.total / 20) * 20,
  ].filter((v, i, a) => v >= totals.total && a.indexOf(v) === i).slice(0, 4);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={onBack} style={{ background: 'transparent', border: 'none', color: C.textMute }}>
        <ArrowLeft size={14} style={{ verticalAlign: 'middle' }} /> Back
      </Button>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginTop: 10 }}>💵 Cash Payment</div>
      <div style={s.payTotalBox}>
        <span style={{ fontWeight: 800 }}>Total due</span>
        <span style={{ fontSize: 26, color: C.primary, fontWeight: 900 }}>{formatUSD(totals.total)}</span>
      </div>

      <Field label="Amount Received">
        <Input
          type="number" step="0.01"
          value={received}
          onChange={e => setReceived(e.target.value)}
          placeholder="0.00"
          autoFocus
          style={{ fontSize: 24, padding: '14px 18px', textAlign: 'right' }}
        />
      </Field>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {quickAmounts.map(a => (
          <button key={a} onClick={() => setReceived(String(a))} style={{
            flex: 1, padding: '8px',
            background: C.card, color: C.text,
            border: 'none', borderRadius: 8,
            fontSize: 13, fontWeight: 800, cursor: 'pointer',
          }}>
            ${a}
          </button>
        ))}
      </div>

      {recvNum > 0 && (
        <div style={{
          background: sufficient ? C.primaryA : C.redA,
          padding: 16, borderRadius: 12, marginBottom: 14,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontWeight: 800, color: sufficient ? C.primary : C.red }}>
            {sufficient ? 'Change' : 'Short by'}
          </span>
          <span style={{ fontSize: 26, fontWeight: 900, color: sufficient ? C.primary : C.red }}>
            {formatUSD(sufficient ? change : totals.total - recvNum)}
          </span>
        </div>
      )}

      <Button
        disabled={!sufficient}
        onClick={async () => {
          if (change > 0) {
            await hardwareService.openCashDrawer().catch(e => console.warn('Cash drawer failed:', e));
          }
          onDone({ method: 'cash', cashReceived: recvNum, changeGiven: change });
        }}
        style={{ width: '100%', opacity: sufficient ? 1 : 0.4 }}
      >
        Complete Sale
      </Button>
    </>
  );
}

// === GIFT CARD FLOW ===
function GiftCardFlow({ order, onBack, onDone }) {
  const totals = calcOrderTotals(order);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onBack} style={{ background: 'transparent', border: 'none', color: C.textMute }}>
        <ArrowLeft size={14} style={{ verticalAlign: 'middle' }} /> Back
      </Button>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginTop: 10 }}>Gift Card</div>
      <div style={s.payTotalBox}>
        <span style={{ fontWeight: 800 }}>Amount</span>
        <span style={{ fontSize: 28, color: C.primary, fontWeight: 900 }}>{formatUSD(totals.total)}</span>
      </div>
      <div style={{ fontSize: 13, color: C.textMute, fontWeight: 700, marginBottom: 18, textAlign: 'center' }}>
        Confirm the gift card was processed, then mark complete.
      </div>
      <Button onClick={() => onDone({ method: 'giftcard' })} style={{ width: '100%' }}>
        Mark as Paid
      </Button>
    </>
  );
}

// === PAX FLOW ===
function PaxFlow({ order, onBack, onDone }) {
  const totals = calcOrderTotals(order);
  const [status, setStatus] = useState(PAX_STATUS.SENDING);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const unsub = paxService.onUpdate(txn => {
      if (!txn) return;
      setStatus(txn.status);
      if (['approved', 'declined', 'cancelled', 'timeout', 'error'].includes(txn.status.id)) {
        setResult(txn);
      }
    });
    paxService.sale(totals.total, `BB${order.number}`).catch(() => {});
    return () => { unsub(); paxService.reset(); };
  }, []);

  const isFinal = ['approved', 'declined', 'cancelled', 'timeout', 'error'].includes(status.id);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={onBack} disabled={!isFinal}
        style={{ background: 'transparent', border: 'none', color: C.textMute }}>
        <ArrowLeft size={14} style={{ verticalAlign: 'middle' }} /> Back
      </Button>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginTop: 10 }}>Card Payment</div>
      <div style={{ fontSize: 13, color: C.textMute, marginTop: 4, fontWeight: 700 }}>
        {paxService.isNative ? 'Customer is using the card terminal' : 'Web preview — simulated card payment flow'}
      </div>

      <div style={s.payTotalBox}>
        <span style={{ fontWeight: 800 }}>Amount due</span>
        <span style={{ fontSize: 28, color: C.primary, fontWeight: 900 }}>{formatUSD(totals.total)}</span>
      </div>

      {!isFinal && <PaxStatusCard status={status} />}

      {result?.status.id === 'approved' && (
        <VerifyTicket order={order} totals={totals} result={result} />
      )}

      {result?.status.id === 'declined' && (
        <div style={s.declineBox}>
          <AlertCircle size={20} />
          <div>
            <div style={{ fontWeight: 900 }}>Declined</div>
            <div style={{ fontSize: 12 }}>{result.declineReason}</div>
          </div>
        </div>
      )}

      {['error', 'timeout', 'cancelled'].includes(result?.status.id) && (
        <div style={s.declineBox}>
          <AlertCircle size={20} />
          <div>
            <div style={{ fontWeight: 900 }}>{result.status.label}</div>
            <div style={{ fontSize: 12 }}>{result.error || 'Card payment did not complete.'}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {!isFinal && (
          <Button variant="ghost" onClick={() => paxService.cancel().then(onBack)}>Cancel</Button>
        )}
        {result?.status.id === 'approved' && (
          <>
            <Button variant="ghost" onClick={onBack} style={{ flex: 1 }}>
              Back
            </Button>
            <Button onClick={() => onDone({
              method: 'card',
              tip: result.tipAmount || 0,
              cardLast4: result.cardLast4,
              cardType: result.cardType,
              authCode: result.authCode,
              paxRefNum: result.refNum,
              paxResponseCode: result.responseCode,
              paxRaw: result.raw,
            })} style={{ flex: 2 }}>
              Complete Sale
            </Button>
          </>
        )}
        {['declined', 'error', 'timeout', 'cancelled'].includes(result?.status.id) && (
          <Button onClick={onBack} variant="ghost" style={{ flex: 1 }}>Try Again</Button>
        )}
      </div>
    </>
  );
}

// ============================================================================
// VERIFY TICKET — Shown after card approval
// ============================================================================
function VerifyTicket({ order, totals, result }) {
  const grandTotal = totals.total + (result.tipAmount || 0);
  return (
    <div style={s.verifyTicket}>
      <div style={s.verifyHead}>PLEASE VERIFY TICKET</div>

      <div style={s.verifyMeta}>
        <span>#{order.number}</span>
        <span>{formatTime(new Date())}</span>
      </div>

      <div style={s.verifyDashed} />

      <div style={s.verifyItems}>
        {order.items.map(line => (
          <div key={line.id} style={s.verifyItemRow}>
            <span>{line.qty}× {line.name}</span>
            <span>{formatUSD(calcLineTotal(line))}</span>
          </div>
        ))}
      </div>

      <div style={s.verifyDashed} />

      <div style={s.verifyRow}><span>Subtotal</span><span>{formatUSD(totals.sub)}</span></div>
      {totals.discount > 0 && (
        <div style={s.verifyRow}><span>Discount</span><span>−{formatUSD(totals.discount)}</span></div>
      )}
      <div style={s.verifyRow}><span>Tax ({(SHOP.tax * 100).toFixed(2)}%)</span><span>{formatUSD(totals.tax)}</span></div>
      <div style={s.verifyRow}><span>Amount Due</span><span style={{ fontWeight: 900 }}>{formatUSD(totals.total)}</span></div>
      <div style={{ ...s.verifyRow, color: C.primary, fontWeight: 800 }}>
        <span>Tip{result.tipAmount > 0 ? ` (${Math.round(result.tipAmount / totals.total * 100)}%)` : ''}</span>
        <span>{formatUSD(result.tipAmount || 0)}</span>
      </div>

      <div style={s.verifyDashed} />

      <div style={{ ...s.verifyRow, fontSize: 18, fontWeight: 900, color: C.primary }}>
        <span>TOTAL DUE</span><span>{formatUSD(grandTotal)}</span>
      </div>

      <div style={s.verifyDashed} />

      <div style={s.verifyRow}>
        <span>{result.cardType || 'Card'} Payment</span>
        <span style={{ fontWeight: 800 }}>{formatUSD(grandTotal)}</span>
      </div>
      <div style={s.verifyRow}>
        <span style={{ color: C.textMute }}>Card</span>
        <span style={{ fontWeight: 800 }}>•••• {result.cardLast4}</span>
      </div>
      <div style={s.verifyRow}>
        <span style={{ color: C.textMute }}>Auth Code</span>
        <span style={{ fontWeight: 800 }}>{result.authCode}</span>
      </div>
      <div style={s.verifyRow}>
        <span style={{ color: C.textMute }}>Status</span>
        <span style={{ fontWeight: 900, color: C.primary }}>APPROVED ✓</span>
      </div>
    </div>
  );
}

function PaxStatusCard({ status }) {
  const animated = ['sending', 'waiting_card', 'reading', 'processing', 'waiting_tip'].includes(status.id);
  const map = {
    sending:      { icon: '📤', title: 'Connecting',         msg: 'Sending to card terminal...' },
    waiting_card: { icon: '💳', title: 'Waiting for card',   msg: 'Customer: insert, tap, or swipe' },
    reading:      { icon: '🔄', title: 'Reading card',       msg: 'Keep card in place' },
    waiting_tip:  { icon: '✋', title: 'Selecting tip',       msg: 'Customer is choosing tip on card terminal' },
    processing:   { icon: '⚙️', title: 'Processing',         msg: 'Almost done...' },
    approved:     { icon: '✓',  title: 'Approved',           msg: '' },
    declined:     { icon: '✕',  title: 'Declined',           msg: '' },
    cancelled:    { icon: '⊘',  title: 'Cancelled',          msg: '' },
  };
  const d = map[status.id] || { icon: '⏳', title: status.label, msg: '' };

  return (
    <div style={{
      background: `linear-gradient(135deg, ${status.color}22, ${C.card})`,
      borderRadius: 14, padding: '24px 20px', textAlign: 'center', margin: '12px 0',
    }}>
      <div style={{
        width: 64, height: 64, background: status.color,
        borderRadius: '50%', margin: '0 auto 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, color: 'white',
        animation: animated ? 'pulse 1.5s infinite' : 'none',
      }}>
        {d.icon}
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color: C.text, marginBottom: 4 }}>{d.title}</div>
      {d.msg && <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700 }}>{d.msg}</div>}
    </div>
  );
}

// ============================================================================
// RECEIPT MODAL
// ============================================================================
function ReceiptModal({ order, onClose }) {
  const totals = calcOrderTotals(order);
  const grandTotal = totals.total + (order.tip || 0);
  const isCard = order.paymentMethod === 'card';
  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      await hardwareService.ready;
      if (hardwareService.config.cashDrawerMode === 'usb_escpos') {
        const bytes = buildReceiptEscpos({ order, totals, grandTotal, isCard });
        await hardwareService.printUsbEscpos(bytes);
      } else {
        printReceipt80mm({ order, totals, grandTotal, isCard });
      }
    } catch (e) {
      alert('Print failed: ' + e.message);
    }
    setTimeout(() => setPrinting(false), 1500);
  };

  return (
    <Modal onClose={onClose} maxWidth={440}>
      <div style={{ padding: 24, textAlign: 'center' }}>
        <ModalClose onClose={onClose} />
        <div style={{
          width: 64, height: 64, background: C.cyan, borderRadius: '50%',
          margin: '8px auto 0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, color: 'white', fontWeight: 900,
          boxShadow: `0 5px 0 ${C.cyanD}`,
        }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginTop: 12 }}>Sale Complete!</div>
        <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginTop: 4 }}>
          Order #{order.number}
        </div>

        {isCard
          ? <CardReceipt order={order} totals={totals} grandTotal={grandTotal} />
          : <CashReceipt order={order} totals={totals} grandTotal={grandTotal} />}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Button variant="ghost" onClick={handlePrint} disabled={printing} style={{ flex: 1 }}>
            {printing ? 'Printing…' : '🖨️ Print Receipt'}
          </Button>
          <Button onClick={onClose} style={{ flex: 1 }}>New Order</Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// 80mm THERMAL PRINT — uses Android system print (Default Printer)
// ============================================================================
function printReceipt80mm({ order, totals, grandTotal, isCard }) {
  const esc = (str) => String(str ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const money = (n) => formatUSD(n);
  const d = order.completedAt ? new Date(order.completedAt) : new Date();
  const t = ORDER_TYPES.find(x => x.id === order.type);

  const itemRows = order.items.map(line => {
    let extra = '';
    if (line.category !== 'snack' && line.category !== 'topping' && (line.size || line.sugar != null || line.ice != null)) {
      extra += `<div class="sub">${line.size === 'L' ? 'Large' : 'Reg'}, ${line.sugar ?? 100}% sugar, ${line.ice ?? 100}% ice</div>`;
    }
    if (line.toppings?.length) {
      extra += `<div class="sub">+ ${esc(line.toppings.map(tp => tp.name).join(', '))}</div>`;
    }
    return `<div class="row"><span>${line.qty}× ${esc(line.name)}</span><span>${money(calcLineTotal(line))}</span></div>${extra}`;
  }).join('');

  const payBlock = isCard ? `
    <div class="row b"><span>Amount Due (Before Tip)</span><span>${money(totals.total)}</span></div>
    <div class="dash"></div>
    <div class="lbl">PAYMENT METHOD</div>
    <div class="row b"><span>Credit Card</span><span>${money(totals.total)}</span></div>
    <div class="row"><span>Card Type</span><span>${esc(order.cardType || '-')}</span></div>
    <div class="row"><span>Card Last 4</span><span>**** ${esc(order.cardLast4 || '----')}</span></div>
    <div class="row"><span>Auth Code</span><span>${esc(order.authCode || '-')}</span></div>
    <div class="row b" style="margin-top:6px"><span>Tip:</span><span>${money(order.tip || 0)}</span></div>
    <div class="row b big"><span>Total (After Tip):</span><span>${money(grandTotal)}</span></div>
  ` : `
    <div class="total"><span>TOTAL</span><span>${money(grandTotal)}</span></div>
    <div class="dash"></div>
    <div class="lbl">PAYMENT METHOD</div>
    <div class="row b"><span>Cash</span><span>${money(order.cashReceived || grandTotal)}</span></div>
    ${order.changeGiven > 0 ? `<div class="row b"><span>Change</span><span>${money(order.changeGiven)}</span></div>` : ''}
  `;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { width: 80mm; padding: 4mm 3mm; font-family: 'Courier New', monospace; color:#000; font-size: 12px; }
.center { text-align:center; }
.shop { font-size: 16px; font-weight:900; }
.small { font-size: 10px; }
.dash { border-top: 1px dashed #000; margin: 6px 0; }
.lbl { font-size: 11px; font-weight:900; margin-bottom:3px; }
.row { display:flex; justify-content:space-between; font-size: 12px; padding: 1px 0; }
.row.b { font-weight:900; }
.row.big { font-size: 14px; }
.sub { font-size: 9px; color:#333; padding-left: 10px; }
.total { display:flex; justify-content:space-between; font-size:16px; font-weight:900; border:2px solid #000; padding:4px 6px; margin-top:4px; }
.meta { font-size: 11px; }
.foot { text-align:center; font-size:12px; font-weight:900; margin-top:4px; }
.foot2 { text-align:center; font-size:10px; color:#333; margin-top:8px; }
</style></head><body>
<div class="center">
  <div class="shop">${esc(SHOP.name.toUpperCase())}</div>
  <div class="small">${esc(SHOP.address || '')}</div>
  <div class="small">${esc(SHOP.phone || '')}</div>
</div>
<div class="dash"></div>
<div class="meta">
  <div class="row"><span>Receipt #:</span><span>${String(order.number).padStart(6, '0')}</span></div>
  <div class="row"><span>Type:</span><span>${esc(t?.label || '')}</span></div>
  ${order.staffName ? `<div class="row"><span>Server:</span><span>${esc(order.staffName)}</span></div>` : ''}
  <div class="row"><span>Date:</span><span>${d.toLocaleDateString()}</span></div>
  <div class="row"><span>Time:</span><span>${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
</div>
<div class="dash"></div>
<div class="lbl">ITEMS</div>
${itemRows}
<div class="dash"></div>
<div class="row"><span>Subtotal</span><span>${money(totals.sub)}</span></div>
${totals.discount > 0 ? `<div class="row"><span>Discount</span><span>-${money(totals.discount)}</span></div>` : ''}
<div class="row"><span>Tax</span><span>${money(totals.tax)}</span></div>
${payBlock}
<div class="dash"></div>
<div class="foot">${esc(SHOP.receiptFooter || 'Thank you!')}</div>
<div class="small center" style="margin-top:2px">We hope to see you again.</div>
<div class="foot2">Customer Copy • Paid by ${isCard ? 'Card' : 'Cash'}</div>
<div style="height: 12mm"></div>
</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error('Print error', e);
    }
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }, 400);
}

function buildReceiptEscpos({ order, totals, grandTotal, isCard }) {
  const enc = new TextEncoder();
  const out = [];
  const push = (...bytes) => out.push(...bytes);
  const text = (s = '') => push(...enc.encode(String(s).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')));
  const line = (s = '') => text(s + '\n');
  const money = (n) => formatUSD(n);
  const d = order.completedAt ? new Date(order.completedAt) : new Date();
  const type = ORDER_TYPES.find(x => x.id === order.type);
  const width = 42;
  const rule = () => line('-'.repeat(width));
  const center = (s = '') => {
    const clean = String(s);
    const pad = Math.max(0, Math.floor((width - clean.length) / 2));
    line(' '.repeat(pad) + clean);
  };
  const row = (left, right) => {
    const l = String(left);
    const r = String(right);
    const gap = Math.max(1, width - l.length - r.length);
    line(l + ' '.repeat(gap) + r);
  };

  push(0x1B, 0x40);       // init
  push(0x1B, 0x61, 0x01); // center
  push(0x1B, 0x45, 0x01); // bold
  center((SHOP.name || 'MY SHOP').toUpperCase());
  push(0x1B, 0x45, 0x00);
  if (SHOP.address) center(SHOP.address);
  if (SHOP.phone) center(SHOP.phone);
  push(0x1B, 0x61, 0x00); // left
  rule();
  row('Receipt #:', String(order.number).padStart(6, '0'));
  row('Type:', type?.label || '');
  if (order.staffName) row('Server:', order.staffName);
  row('Date:', d.toLocaleDateString());
  row('Time:', d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  rule();
  line('ITEMS');
  (order.items || []).forEach(lineItem => {
    row(`${lineItem.qty} x ${lineItem.name}`, money(calcLineTotal(lineItem)));
    if (lineItem.category !== 'snack' && lineItem.category !== 'topping') {
      line(`  ${lineItem.size === 'L' ? 'Large' : 'Regular'}, ${lineItem.sugar ?? 100}% sugar, ${lineItem.ice ?? 100}% ice`);
    }
    if (lineItem.toppings?.length) {
      line(`  + ${lineItem.toppings.map(t => t.name).join(', ')}`);
    }
  });
  rule();
  row('Subtotal', money(totals.sub));
  if (totals.discount > 0) row('Discount', '-' + money(totals.discount));
  row('Tax', money(totals.tax));
  rule();
  if (isCard) {
    row('Credit Card', money(totals.total));
    row('Card Type', order.cardType || '-');
    row('Card Last 4', order.cardLast4 ? `**** ${order.cardLast4}` : '----');
    row('Auth Code', order.authCode || '-');
    row('Tip', money(order.tip || 0));
    push(0x1B, 0x45, 0x01);
    row('TOTAL', money(grandTotal));
    push(0x1B, 0x45, 0x00);
  } else {
    push(0x1B, 0x45, 0x01);
    row('TOTAL', money(grandTotal));
    push(0x1B, 0x45, 0x00);
    row('Cash', money(order.cashReceived || grandTotal));
    if (order.changeGiven > 0) row('Change', money(order.changeGiven));
  }
  rule();
  push(0x1B, 0x61, 0x01);
  center(SHOP.receiptFooter || 'Thank you!');
  center('We hope to see you again.');
  push(0x1B, 0x61, 0x00);
  line('\n\n');
  push(0x1D, 0x56, 0x42, 0x00); // partial cut
  return new Uint8Array(out);
}

export async function printKitchenTicket(order) {
  try {
    await hardwareService.ready;
    const bytes = buildKitchenTicketEscpos(order);
    if (hardwareService.config.cashDrawerMode === 'usb_escpos') {
      await hardwareService.printUsbEscpos(bytes);
      return;
    }
  } catch (e) {
    console.warn('Native kitchen ticket unavailable, falling back to browser print:', e);
  }
  printKitchenTicket80mm(order);
}

// Friendly source banner so the kitchen instantly sees where an order came from.
function sourceLabel(order) {
  const s = String(order.source || 'pos').toLowerCase();
  if (s.includes('online') || s.includes('web')) return 'ONLINE ORDER';
  if (s.includes('kiosk')) return 'KIOSK ORDER';
  return 'COUNTER';
}

function buildKitchenTicketEscpos(order) {
  const enc = new TextEncoder();
  const out = [];
  const push = (...bytes) => out.push(...bytes);
  const text = (s = '') => push(...enc.encode(String(s).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')));
  const line = (s = '') => text(s + '\n');
  const width = 42;
  const rule = () => line('-'.repeat(width));
  const bold = (on) => push(0x1B, 0x45, on ? 0x01 : 0x00);
  const big = (on) => push(0x1D, 0x21, on ? 0x11 : 0x00); // double width+height / normal
  const align = (n) => push(0x1B, 0x61, n);               // 0 left, 1 center

  push(0x1B, 0x40); // reset

  // 1) BIG source banner + order number — visible across the kitchen.
  align(1); bold(1); big(1);
  line(sourceLabel(order));
  line(`#${order.number}`);
  big(0); align(0);

  // 2) Type + table, time.
  const type = String(order.type || order.orderType || '').toUpperCase();
  bold(1); line(`${type}${order.tableNumber ? `   TABLE ${order.tableNumber}` : ''}`); bold(0);
  line(new Date(order.completedAt || Date.now()).toLocaleString());

  // 3) Customer (for pickup call-out on online/kiosk orders).
  if (order.customerName) { bold(1); line(`Customer: ${order.customerName}`); bold(0); }
  if (order.customerPhone) line(`Tel: ${order.customerPhone}`);

  rule();
  (order.items || []).forEach(item => {
    bold(1);
    line(`${item.qty || item.quantity || 1} x ${item.name}`);
    bold(0);
    if (item.category !== 'snack' && item.category !== 'topping' && (item.size || item.sugar != null || item.ice != null)) {
      line(`  ${item.size === 'L' ? 'Large' : 'Regular'}, ${item.sugar ?? 100}% sugar, ${item.ice ?? 100}% ice`);
    }
    if (item.toppings?.length) line(`  + ${item.toppings.map(t => t.name).join(', ')}`);
    if (item.note) { bold(1); line(`  >> ${item.note}`); bold(0); } // per-item note (e.g. "less ice")
  });
  if (order.note) { rule(); bold(1); line(`NOTE: ${order.note}`); bold(0); }
  rule();
  line('\n\n');
  push(0x1D, 0x56, 0x42, 0x00); // cut
  return new Uint8Array(out);
}

function printKitchenTicket80mm(order) {
  const esc = (str) => String(str ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = (order.items || []).map(item => `
    <div class="item">${item.qty || item.quantity || 1} x ${esc(item.name)}</div>
    ${item.category !== 'snack' && item.category !== 'topping' && (item.size || item.sugar != null || item.ice != null)
      ? `<div class="sub">${item.size === 'L' ? 'Large' : 'Regular'}, ${item.sugar ?? 100}% sugar, ${item.ice ?? 100}% ice</div>`
      : ''}
    ${item.toppings?.length ? `<div class="sub">+ ${esc(item.toppings.map(t => t.name).join(', '))}</div>` : ''}
    ${item.note ? `<div class="inote">&gt;&gt; ${esc(item.note)}</div>` : ''}
  `).join('');
  const type = String(order.type || order.orderType || '').toUpperCase();
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kitchen Ticket</title>
<style>
@page { size: 80mm auto; margin: 0; }
body { width:80mm; padding:4mm 3mm; font-family:'Courier New',monospace; color:#000; font-size:13px; }
.banner { font-size:22px; font-weight:900; text-align:center; border:2px solid #000; border-radius:6px; padding:4px 0; }
.head { font-size:30px; font-weight:900; text-align:center; margin:4px 0 2px; }
.type { font-size:15px; font-weight:900; text-align:center; }
.meta { font-size:11px; text-align:center; margin:2px 0 5px; }
.cust { font-size:15px; font-weight:900; margin-top:4px; }
.tel { font-size:13px; }
.dash { border-top:1px dashed #000; margin:7px 0; }
.item { font-size:16px; font-weight:900; margin-top:6px; }
.sub { font-size:12px; padding-left:12px; }
.inote { font-size:14px; font-weight:900; padding-left:12px; }
.note { font-size:14px; font-weight:900; }
</style></head><body>
<div class="banner">${esc(sourceLabel(order))}</div>
<div class="head">#${esc(order.number)}</div>
<div class="type">${esc(type)}${order.tableNumber ? ` &middot; TABLE ${esc(order.tableNumber)}` : ''}</div>
<div class="meta">${new Date(order.completedAt || Date.now()).toLocaleString()}</div>
${order.customerName ? `<div class="cust">Customer: ${esc(order.customerName)}</div>` : ''}
${order.customerPhone ? `<div class="tel">Tel: ${esc(order.customerPhone)}</div>` : ''}
<div class="dash"></div>
${rows}
${order.note ? `<div class="dash"></div><div class="note">NOTE: ${esc(order.note)}</div>` : ''}
<div style="height:12mm"></div>
</body></html>`;
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error('Kitchen print error', e);
    }
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }, 400);
}

// ----- Cash receipt (image 1 style) -----
function CashReceipt({ order, totals, grandTotal }) {
  return (
    <div style={s.receiptPaper}>
      <ReceiptHeader />
      <ReceiptMeta order={order} />
      <ReceiptItems order={order} />
      <div style={s.receiptDash} />
      <ReceiptRow label="Subtotal" value={formatUSD(totals.sub)} />
      {totals.discount > 0 && <ReceiptRow label="Discount" value={`−${formatUSD(totals.discount)}`} />}
      <ReceiptRow label="Tax" value={formatUSD(totals.tax)} />
      <div style={s.receiptTotalBox}>
        <span>TOTAL</span><span>{formatUSD(grandTotal)}</span>
      </div>

      <div style={s.receiptDash} />
      <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 6 }}>PAYMENT METHOD</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 13 }}>
        <span>Cash</span><span>{formatUSD(order.cashReceived || grandTotal)}</span>
      </div>
      {order.changeGiven > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 13 }}>
          <span>Change</span><span>{formatUSD(order.changeGiven)}</span>
        </div>
      )}

      <div style={s.receiptDash} />
      <ReceiptFooter />
      <div style={{ textAlign: 'center', fontSize: 10, color: '#666', marginTop: 10 }}>
        Customer Copy • Paid by Cash
      </div>
    </div>
  );
}

// ----- Card receipt (image 2 style, tip filled in from card terminal) -----
function CardReceipt({ order, totals, grandTotal }) {
  return (
    <div style={s.receiptPaper}>
      <ReceiptHeader />
      <ReceiptMeta order={order} />
      <ReceiptItems order={order} />
      <div style={s.receiptDash} />
      <ReceiptRow label="Subtotal" value={formatUSD(totals.sub)} />
      {totals.discount > 0 && <ReceiptRow label="Discount" value={`−${formatUSD(totals.discount)}`} />}
      <ReceiptRow label="Tax" value={formatUSD(totals.tax)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 900, marginTop: 4 }}>
        <span>Amount Due (Before Tip)</span><span>{formatUSD(totals.total)}</span>
      </div>

      <div style={s.receiptDash} />
      <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 6 }}>PAYMENT METHOD</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 13 }}>
        <span>Credit Card</span><span>{formatUSD(totals.total)}</span>
      </div>
      <ReceiptRow label="Card Type" value={order.cardType || '—'} />
      <ReceiptRow label="Card Last 4" value={`**** ${order.cardLast4 || '----'}`} />
      <ReceiptRow label="Auth Code" value={order.authCode || '—'} />

      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 13 }}>
          <span>Tip:</span><span>{formatUSD(order.tip || 0)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 14, marginTop: 4 }}>
          <span>Total (After Tip):</span><span>{formatUSD(grandTotal)}</span>
        </div>
      </div>

      <div style={s.receiptDash} />
      <ReceiptFooter />
      <div style={{ textAlign: 'center', fontSize: 10, color: '#666', marginTop: 10 }}>
        Customer Copy • Paid by Card
      </div>
    </div>
  );
}

function ReceiptHeader() {
  return (
    <div style={{ textAlign: 'center', borderBottom: '1px dashed #888', paddingBottom: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 16, fontWeight: 900 }}>{SHOP.name.toUpperCase()}</div>
      <div style={{ fontSize: 10, marginTop: 2 }}>{SHOP.address}</div>
      <div style={{ fontSize: 10 }}>{SHOP.phone}</div>
    </div>
  );
}

function ReceiptMeta({ order }) {
  const t = ORDER_TYPES.find(x => x.id === order.type);
  const d = order.completedAt ? new Date(order.completedAt) : new Date();
  return (
    <div style={{ fontSize: 11, marginBottom: 6 }}>
      <Row2 label="Receipt #:" value={String(order.number).padStart(6, '0')} />
      <Row2 label="Type:" value={t?.label || ''} />
      {order.staffName && <Row2 label="Server:" value={order.staffName} />}
      <Row2 label="Date:" value={d.toLocaleDateString()} />
      <Row2 label="Time:" value={d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} />
    </div>
  );
}

function ReceiptItems({ order }) {
  return (
    <>
      <div style={s.receiptDash} />
      <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 4 }}>ITEMS</div>
      {order.items.map(line => (
        <div key={line.id} style={{ marginBottom: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
            <span>{line.qty}× {line.name}</span>
            <span>{formatUSD(calcLineTotal(line))}</span>
          </div>
          {(line.category !== 'snack' && line.category !== 'topping') && (line.size || line.sugar || line.ice) && (
            <div style={{ fontSize: 9, paddingLeft: 16, color: '#666' }}>
              {line.size === 'L' ? 'Large' : 'Reg'}, {line.sugar ?? 100}% sugar, {line.ice ?? 100}% ice
            </div>
          )}
          {line.toppings?.length > 0 && (
            <div style={{ fontSize: 9, paddingLeft: 16, color: '#666' }}>
              + {line.toppings.map(t => t.name).join(', ')}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function ReceiptFooter() {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 12, fontWeight: 900 }}>{SHOP.receiptFooter || 'Thank you!'}</div>
      <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>We hope to see you again.</div>
    </div>
  );
}

function ReceiptRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

function Row2({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      <span style={{ color: '#444' }}>{label}</span><span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const kioskStyles = {
  screen: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '132px minmax(0, 1fr) minmax(340px, 28vw)',
    gap: 14,
    height: '100%',
    padding: 16,
    background: C.bg,
    color: C.text,
  },
  // Portrait kiosk (screen taller than wide): stack categories on top,
  // menu in the middle, cart pinned to the bottom.
  screenPortrait: {
    gridTemplateColumns: '1fr',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
  },
  catBarPortrait: {
    gridAutoFlow: 'column',
    gridAutoColumns: '96px',
    gridTemplateColumns: 'none',
    overflowX: 'auto',
    overflowY: 'hidden',
  },
  cartPortrait: {
    maxHeight: '42vh',
  },
  catBar: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 10,
    display: 'grid',
    gap: 10,
    alignContent: 'start',
    overflowY: 'auto',
  },
  catButton: {
    minHeight: 86,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: C.card,
    color: C.text,
    display: 'grid',
    placeItems: 'center',
    gap: 4,
    fontWeight: 900,
    fontSize: 13,
    cursor: 'pointer',
  },
  catActive: {
    background: C.primary,
    color: C.bg,
    borderColor: C.primary,
    boxShadow: `inset 0 -3px 0 ${C.primaryD}`,
  },
  catIcon: { fontSize: 24, lineHeight: 1 },
  menuArea: {
    minWidth: 0,
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 14,
    overflowY: 'auto',
  },
  kioskHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 },
  kioskTitle: { fontSize: 26, fontWeight: 900, color: C.text },
  kioskSub: { fontSize: 13, fontWeight: 800, color: C.textMute, marginTop: 3 },
  adminHotspot: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: 70,
    height: 70,
    zIndex: 1000,
    background: 'transparent',
    cursor: 'default',
  },
  settingsFloat: {
    position: 'fixed',
    top: 14,
    right: 14,
    zIndex: 1000,
    minWidth: 138,
    height: 54,
    borderRadius: 14,
    border: `2px solid ${C.primaryD}`,
    background: C.primary,
    color: C.bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontSize: 16,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: `0 4px 0 ${C.primaryD}`,
  },
  kioskBrand: {
    width: 50, height: 50, borderRadius: 14,
    background: C.primaryG, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 30, fontWeight: 900, fontFamily: 'Arial Black, sans-serif',
  },
  adminButton: {
    minWidth: 132,
    height: 48,
    borderRadius: 12,
    border: 'none',
    background: C.primary,
    color: C.bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontSize: 16,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: `0 3px 0 ${C.primaryD}`,
  },
  productGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 },
  productTile: {
    position: 'relative',
    zIndex: 2,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    background: C.card,
    color: C.text,
    textAlign: 'left',
    padding: 0,
    overflow: 'hidden',
    cursor: 'pointer',
    boxShadow: `0 5px 16px ${C.shadow}`,
  },
  productImage: {
    width: 'calc(100% - 18px)',
    aspectRatio: '1 / 1',
    margin: '9px auto 0',
    borderRadius: 10,
    display: 'grid',
    placeItems: 'center',
    fontSize: 56,
  },
  productInfo: { padding: '12px 13px 13px' },
  productName: { minHeight: 38, fontSize: 15, lineHeight: 1.25, fontWeight: 900, color: C.text, marginBottom: 9 },
  productBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  productPrice: { fontSize: 15, fontWeight: 900, color: C.text },
  productAdd: { background: C.primary, color: C.bg, padding: '9px 15px', borderRadius: 10, fontWeight: 900, fontSize: 13, boxShadow: `0 2px 0 ${C.primaryD}` },
  hotBadge: { position: 'absolute', top: 7, left: 7, background: '#FB7185', color: '#fff', borderRadius: 999, padding: '4px 9px', fontSize: 10, fontWeight: 900 },
  inCartBadge: { position: 'absolute', top: 7, right: 7, background: C.cyan, color: C.bg, borderRadius: 999, padding: '4px 9px', fontSize: 10, fontWeight: 900 },
  cart: {
    minWidth: 0,
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
  },
  cartTitle: { fontSize: 18, fontWeight: 900, color: C.text, marginBottom: 12 },
  cartList: { flex: 1, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start', minHeight: 0 },
  emptyCart: { color: C.textMute, fontWeight: 800, textAlign: 'center', marginTop: 60, fontSize: 14 },
  cartItem: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px 74px', gap: 8, alignItems: 'center', background: C.card, borderRadius: 10, padding: 10 },
  cartName: { fontSize: 14, fontWeight: 900, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cartMods: { fontSize: 11, color: C.textMute, fontWeight: 800, marginTop: 3 },
  qty: { display: 'grid', gridTemplateColumns: '28px 1fr 28px', alignItems: 'center', gap: 5, fontWeight: 900, textAlign: 'center' },
  lineTotal: { fontSize: 13, fontWeight: 900, color: C.primary, textAlign: 'right' },
  totals: { borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 14 },
  subRow: { display: 'flex', justifyContent: 'space-between', color: C.textMute, fontSize: 13, fontWeight: 800, marginBottom: 5 },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 22, fontWeight: 900, color: C.text, marginTop: 8 },
  tipButton: {
    padding: 13,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    cursor: 'pointer',
    display: 'grid',
    gap: 3,
    fontWeight: 900,
  },
  tipActive: { background: C.primary, color: C.bg, borderColor: C.primary },
  paySummary: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: C.card,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    fontWeight: 900,
    marginTop: 10,
  },
  approvedBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    background: C.primaryA,
    color: C.primary,
    borderRadius: 14,
    padding: 16,
    margin: '16px 0',
  },
  settingsPanel: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  settingsTitle: {
    fontSize: 12,
    fontWeight: 900,
    color: C.textMute,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  settingCheck: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: C.text,
    fontSize: 14,
    fontWeight: 900,
    marginBottom: 12,
  },
  settingsSelect: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    fontFamily: 'inherit',
    fontWeight: 900,
    fontSize: 14,
  },
  settingsNote: {
    padding: '10px 12px',
    borderRadius: 10,
    marginBottom: 12,
    background: 'rgba(252, 211, 77, 0.10)',
    color: C.text,
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.5,
  },
  resultBox: {
    marginTop: 12,
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 900,
  },
  advancedToggle: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'transparent', border: 'none', color: C.textMute,
    fontWeight: 800, fontSize: 13, cursor: 'pointer',
    padding: '10px 2px', marginBottom: 4,
  },
  doneScreen: { height: '100%', display: 'grid', placeItems: 'center', background: C.bg, color: C.text, padding: 20 },
  doneCard: { width: 'min(540px, 100%)', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 18, padding: 34, textAlign: 'center' },
  doneCheck: { width: 78, height: 78, borderRadius: 999, background: C.primary, color: C.bg, display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 42, fontWeight: 900 },
  doneTitle: { fontSize: 28, fontWeight: 900, color: C.text },
  doneNumber: { fontSize: 56, fontWeight: 900, color: C.primary, marginTop: 6 },
  doneText: { fontSize: 14, fontWeight: 800, color: C.textMute, marginTop: 8 },
};

const s = {
  workspace: { display: 'flex', flex: 1, overflow: 'hidden' },

  orderRail: {
    width: 140, background: C.panel,
    borderRight: `1px solid ${C.border}`,
    flexShrink: 0, display: 'flex', flexDirection: 'column',
  },
  railHead: {
    padding: '12px 14px', fontWeight: 800, fontSize: 12,
    color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5,
    borderBottom: `1px solid ${C.border}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  railAdd: {
    width: 26, height: 26, background: C.primary, color: C.bg,
    border: 'none', borderRadius: 999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: `0 2px 0 ${C.primaryD}`,
  },
  railItem: {
    width: '100%', background: C.card, padding: '10px 12px',
    borderRadius: 12, border: 'none', color: C.text,
    fontWeight: 700, marginBottom: 8, cursor: 'pointer', textAlign: 'left',
  },
  railItemActive: { background: C.primary, color: C.bg, boxShadow: `0 3px 0 ${C.primaryD}` },
  railItemNo: { fontWeight: 800, fontSize: 13 },
  railItemMeta: { fontSize: 11, opacity: 0.85, marginTop: 4, fontWeight: 600 },
  railItemPrice: { fontSize: 15, marginTop: 4, fontWeight: 900 },

  middle: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  orderBar: {
    padding: '12px 16px', background: C.panel,
    borderBottom: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0, gap: 10,
  },
  typeToggle: { display: 'flex', background: C.card, padding: 4, borderRadius: 12, gap: 4 },
  typeBtn: {
    padding: '10px 16px', fontWeight: 900, fontSize: 14,
    color: C.textMute, background: 'transparent',
    border: 'none', borderRadius: 10, cursor: 'pointer',
  },
  typeBtnActive: { background: C.cyan, color: C.bg, boxShadow: `0 3px 0 ${C.cyanD}` },
  searchWrap: {
    background: C.card, padding: '10px 16px', borderRadius: 999,
    display: 'flex', alignItems: 'center', minWidth: 240,
  },
  searchInput: {
    background: 'transparent', border: 'none', outline: 'none',
    color: C.text, fontWeight: 800, fontSize: 14, marginLeft: 8,
    flex: 1, fontFamily: 'inherit',
  },
  drawerWrap: { position: 'relative', flexShrink: 0 },
  drawerBtn: {
    background: C.primaryA, color: C.primary,
    border: `1px solid ${C.primary}`,
    borderRadius: 999, padding: '11px 16px',
    fontWeight: 900, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 7,
    whiteSpace: 'nowrap',
  },
  drawerToast: {
    position: 'absolute', right: 0, top: 'calc(100% + 6px)',
    padding: '8px 10px', borderRadius: 8,
    fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
    zIndex: 20,
    boxShadow: `0 8px 24px ${C.shadow}`,
  },

  innerRow: { display: 'flex', flex: 1, overflow: 'hidden' },
  catRail: {
    width: 118, background: C.panel,
    borderRight: `1px solid ${C.border}`,
    padding: '14px 10px', flexShrink: 0,
    overflowY: 'auto',
  },
  catBtn: {
    width: '100%', padding: '13px 6px',
    borderRadius: 14, textAlign: 'center',
    color: C.textMute, fontWeight: 900,
    marginBottom: 8, background: 'transparent',
    border: 'none', cursor: 'pointer',
  },
  catBtnActive: { background: C.primary, color: C.bg, boxShadow: `0 3px 0 ${C.primaryD}` },
  catName: { fontSize: 13, lineHeight: 1.2, marginTop: 6 },

  gridWrap: { flex: 1, padding: 16, overflowY: 'auto' },
  empty: {
    textAlign: 'center', padding: 60,
    color: C.textDim, fontSize: 14, fontWeight: 700,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 15,
  },
  product: {
    position: 'relative',
    borderRadius: 12, overflow: 'hidden',
    background: C.panel, color: C.text,
    border: `1px solid ${C.border}`, cursor: 'pointer',
    textAlign: 'left', padding: 0,
    minHeight: 0,
    boxShadow: `0 5px 16px ${C.shadow}`,
  },
  productImg: {
    width: 'calc(100% - 20px)',
    aspectRatio: '1 / 1',
    margin: '10px auto 0',
    borderRadius: 10,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: 58,
  },
  productBody: { padding: '12px 13px 13px' },
  productName: { fontWeight: 900, fontSize: 15, lineHeight: 1.25, marginBottom: 9, color: C.text, minHeight: 38 },
  productFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  productPrice: { fontSize: 15, fontWeight: 900, color: C.text },
  productAdd: {
    background: C.primary, color: C.bg,
    padding: '9px 15px', borderRadius: 10,
    fontWeight: 900, fontSize: 13,
    boxShadow: `0 2px 0 ${C.primaryD}`,
  },
  popular: {
    position: 'absolute', top: 7, left: 7,
    background: '#FB7185', color: 'white',
    fontSize: 10, fontWeight: 900, padding: '4px 9px',
    borderRadius: 999, letterSpacing: 0.5,
  },
  addedBadge: {
    position: 'absolute', top: 7, right: 7,
    background: C.cyan, color: C.bg,
    fontSize: 11, fontWeight: 900, padding: '4px 9px',
    borderRadius: 999,
  },
  soldOut: {
    position: 'absolute', top: '50%', left: 0, right: 0,
    transform: 'translateY(-50%)',
    background: 'rgba(0,0,0,0.7)', color: 'white',
    fontSize: 12, fontWeight: 900, padding: 6,
    textAlign: 'center', letterSpacing: 1,
  },

  cart: {
    width: 360, background: C.panel,
    borderLeft: `1px solid ${C.border}`,
    flexShrink: 0, display: 'flex', flexDirection: 'column',
  },
  cartHead: {
    padding: '16px 17px', fontWeight: 900, fontSize: 16,
    color: C.text, borderBottom: `1px solid ${C.border}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  cartHeadDate: { fontSize: 12, color: C.textMute, fontWeight: 800 },
  cartMeta: { padding: '10px 14px', borderBottom: `1px solid ${C.border}` },
  dashedBtn: {
    padding: 10, background: 'transparent',
    border: `2px dashed ${C.border}`, borderRadius: 10,
    textAlign: 'center', color: C.textMute, fontWeight: 900, fontSize: 14,
  },
  cartList: { flex: 1, padding: 10, overflowY: 'auto' },
  cartEmpty: {
    textAlign: 'center', padding: 40,
    color: C.textDim, fontSize: 13, fontWeight: 700,
  },
  cartItem: { padding: 10, background: C.card, borderRadius: 12, marginBottom: 8, display: 'flex' },
  cartImg: {
    width: 44, height: 44, borderRadius: 9,
    marginRight: 10, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
  },
  cartBody: { flex: 1, minWidth: 0 },
  cartName: { fontWeight: 900, fontSize: 14, lineHeight: 1.3, color: C.text },
  cartMetaLine: { fontSize: 12, color: C.textMute, marginTop: 2, fontWeight: 800 },
  cartTops: { fontSize: 12, color: C.primary, marginTop: 2, fontWeight: 800 },
  cartRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  qtyBox: {
    display: 'flex', alignItems: 'center',
    background: C.panel, borderRadius: 999, padding: 3,
  },
  qtyBtn: {
    width: 26, height: 26, background: C.primary, color: C.bg,
    borderRadius: 999, border: 'none',
    textAlign: 'center', lineHeight: '26px',
    fontWeight: 900, fontSize: 15, cursor: 'pointer',
  },
  qtyNum: { minWidth: 28, textAlign: 'center', fontSize: 14, fontWeight: 900, color: C.text },
  cartPrice: { fontSize: 16, fontWeight: 900, color: C.text },

  cartFoot: { padding: '12px 14px', borderTop: `1px solid ${C.border}` },
  chipRow: { marginBottom: 8, display: 'flex', gap: 6 },
  chip: {
    padding: '8px 13px', background: C.card, color: C.text,
    borderRadius: 999, fontWeight: 900, fontSize: 13,
    border: 'none', cursor: 'pointer',
  },
  totals: { background: C.card, padding: 14, borderRadius: 12, marginBottom: 10 },
  subRow: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 14, color: C.textMute, fontWeight: 800, padding: '4px 0',
  },
  totalRow: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 8, paddingTop: 8,
    borderTop: `1px dashed ${C.primary}`,
    fontWeight: 800, color: C.text,
  },
  totalAmt: { fontSize: 28, color: C.primary, fontWeight: 900 },
  tipHint: { marginTop: 7, fontSize: 12, color: C.yellow, fontWeight: 800 },
  payRow: { display: 'flex', gap: 8 },
  payBtn: {
    flex: 1, background: C.primaryG, color: C.bg,
    padding: 16, borderRadius: 12,
    fontSize: 17, fontWeight: 900, letterSpacing: 0,
    boxShadow: C.primaryGShadow,
    border: 'none', cursor: 'pointer',
  },

  modalFooter: {
    padding: 18, borderTop: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  payTotalBox: {
    background: C.card, padding: 16, borderRadius: 14,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 14, color: C.text,
  },
  approvalBox: {
    background: 'rgba(45,212,191,0.1)',
    border: `1px solid ${C.cyan}33`,
    padding: 14, borderRadius: 12, marginTop: 14,
  },
  declineBox: {
    background: C.redA, border: `1px solid ${C.red}33`,
    padding: 14, borderRadius: 12, marginTop: 14,
    color: C.red, display: 'flex', gap: 10,
  },
  rowBetween: {
    display: 'flex', justifyContent: 'space-between',
    padding: '4px 0', fontSize: 13, color: C.text, fontWeight: 700,
  },
  verifyTicket: {
    background: '#fff', color: '#000',
    padding: '14px 18px', borderRadius: 10, marginTop: 14,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    border: `2px solid ${C.primary}`,
  },
  verifyHead: {
    background: C.primary, color: '#000',
    margin: '-14px -18px 12px',
    padding: '10px 16px', textAlign: 'center',
    fontWeight: 900, fontSize: 14, letterSpacing: 1,
    borderTopLeftRadius: 8, borderTopRightRadius: 8,
  },
  verifyMeta: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 12, fontWeight: 700, color: '#333',
  },
  verifyDashed: {
    borderTop: '1px dashed #999', margin: '10px 0',
  },
  verifyItems: { fontSize: 12, color: '#000' },
  verifyItemRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '3px 0',
  },
  verifyRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '3px 0', fontSize: 13, color: '#000', fontWeight: 600,
  },
  receiptPaper: {
    background: '#fff', borderRadius: 8, padding: 16,
    margin: '16px 0', textAlign: 'left', color: '#000',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  receiptDash: {
    borderTop: '1px dashed #888', margin: '8px 0',
  },
  receiptTotalBox: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 16, fontWeight: 900, marginTop: 4,
    border: '2px solid #000', padding: '6px 8px', borderRadius: 4,
  },
};

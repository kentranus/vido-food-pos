import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  ShoppingCart, Receipt, BarChart3, Settings as SettingsIcon, Wifi, WifiOff,
  LogOut, Moon, Sun, Menu as MenuIcon, Utensils, Users, Store, CreditCard,
  LifeBuoy, Archive, Monitor, Activity,
} from 'lucide-react';
import { C, applyTheme, getInitialTheme } from './theme';
import { SHOP } from './config';
import { paxService } from './services/paxBridge';
import { getCurrentStaff, clearCurrentStaff } from './services/staffStorage';
import { loadMenu, loadCategories } from './services/menuStorage';
import { loadShop, saveShop } from './services/shopStorage';
import { initOrderCounter } from './services/orderStorage';
import { startHubPolling } from './services/hubIngest';
import { orderHubService } from './services/orderHubService';
import { embeddedHub, LOCAL_HUB_URL } from './services/embeddedHub';
import { loadMode, saveMode, MODE_POS, MODE_KIOSK } from './services/modeStorage';
import { DEFAULT_MENU, DEFAULT_CATEGORIES } from './data/defaultMenu';
import { APP_VERSION, BUILD_NUMBER } from './version';
import { PinLockScreen, BrandMark, Avatar } from './components/Shared';
import { logActivity } from './services/activityStorage';
import { OrderView, KioskOrderView } from './views/OrderView';
import { HistoryView } from './views/HistoryView';
import { ReportsView } from './views/ReportsView';
import { OperationsView } from './views/OperationsView';
import { SettingsView } from './views/SettingsView';
import { cloudService } from './services/cloudService';
import { CloudLoginScreen, LicenseLockScreen, OnlineOrdersProvider, NewOrderTakeover, OrdersBoard } from './views/OnlineOrders';
import { ClipboardList } from 'lucide-react';
import { startShift, endShift } from './services/shiftStorage';
import { registerPush } from './services/fcmService';

// The device mode (POS vs Kiosk) is no longer fixed at build time — it is a
// per-device setting loaded from storage at startup (see services/modeStorage).
// One APK can therefore be flipped between a full POS and a customer Kiosk.
const KIOSK_STAFF = {
  id: 'kiosk',
  name: 'Kiosk',
  role: 'kiosk',
};

// =====================================================================
// SHOP CONTEXT — globally accessible shop info + updater
// =====================================================================
const ShopContext = createContext({ shop: SHOP, updateShop: async () => {} });
export const useShop = () => useContext(ShopContext);

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme());
  const [mode, setMode] = useState(null);          // 'pos' | 'kiosk' — null until loaded from storage
  const [view, setView] = useState('sell');
  const [staff, setStaff] = useState(null);
  const [shop, setShop] = useState(SHOP);
  const [menu, setMenu] = useState(DEFAULT_MENU);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [settingsTab, setSettingsTab] = useState('pax');
  const [cloudIn, setCloudIn] = useState(false);                 // device linked to a restaurant account
  const [license, setLicense] = useState({ checked: false, allowed: true, reason: '' });

  const isKiosk = mode === MODE_KIOSK;

  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    Promise.all([loadMenu(), loadCategories(), loadShop(), initOrderCounter(), loadMode(), cloudService.ready])
      .then(([m, c, s, _counter, savedMode]) => {
        setMenu(m); setCategories(c); setShop(s);
        setMode(savedMode);
        setCloudIn(cloudService.isLoggedIn());
        if (savedMode === MODE_KIOSK) { setStaff(KIOSK_STAFF); setView('kiosk'); }
        setLoading(false);
      });
  }, []);

  // License gate — re-check on link + every 5 min. Backend allows an offline
  // grace window (cached in cloudService), so this never hard-locks on a blip.
  useEffect(() => {
    if (!cloudIn) { setLicense({ checked: true, allowed: false, reason: 'not_linked' }); return; }
    let alive = true;
    const run = async () => {
      const r = await cloudService.checkLicense();
      if (alive) setLicense({ checked: true, allowed: r.allowed, reason: r.reason });
    };
    run();
    const t = setInterval(run, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [cloudIn]);

  // Register for FCM push once the device is linked, so "new order" alerts ring
  // even when the app is closed / screen locked (native only; web is a no-op).
  useEffect(() => {
    if (!cloudIn) return;
    registerPush({ onToken: (t) => cloudService.registerFcmToken(t).catch(() => {}) });
  }, [cloudIn]);

  const recheckLicense = async () => {
    const r = await cloudService.checkLicense();
    setLicense({ checked: true, allowed: r.allowed, reason: r.reason });
  };
  const unlinkDevice = async () => {
    await endShift();
    await cloudService.logout();
    clearCurrentStaff();
    setStaff(null);
    setCloudIn(false);
    setLicense({ checked: false, allowed: true, reason: '' });
  };

  // Background order sync between kiosk(s) and POS. Re-runs whenever the device
  // mode changes (e.g. a manager flips this tablet from POS to Kiosk), so the
  // right sync strategy is always active.
  //  - POS: host an in-app hub (the tablet itself is the switchboard — no
  //    separate computer needed), then continuously pull kiosk orders + print.
  //  - Kiosk: keep retrying any order that couldn't reach the POS.
  useEffect(() => {
    if (loading || !mode) return;
    if (isKiosk) {
      return orderHubService.startOutboxAutoFlush(7000);
    }
    let stopPolling = () => {};
    let stopped = false;
    (async () => {
      const hub = await embeddedHub.start();
      if (stopped) return;
      if (hub.running) {
        // The POS hosts its own hub → it talks to itself on localhost.
        await orderHubService.updateConfig({ enabled: true, hubUrl: LOCAL_HUB_URL });
      }
      stopPolling = startHubPolling({ intervalMs: 6000, staffName: 'POS' });
    })();
    return () => { stopped = true; stopPolling(); embeddedHub.stop(); };
  }, [loading, mode, isKiosk]);

  const updateShop = async (updates) => {
    const newShop = await saveShop({ ...shop, ...updates });
    setShop(newShop);
    return newShop;
  };

  // Flip this device between POS and Kiosk mode (persisted per-device).
  //  - POS → Kiosk: lock straight into the customer self-order screen.
  //  - Kiosk → POS: drop back to the manager PIN sign-in for safety.
  const changeMode = async (nextMode) => {
    const saved = await saveMode(nextMode);
    logActivity('mode_change', `Switched device to ${saved.toUpperCase()} mode`, { staff });
    setMode(saved);
    if (saved === MODE_KIOSK) {
      setStaff(KIOSK_STAFF);
      setView('kiosk');
    } else {
      clearCurrentStaff();
      setStaff(null);
      setView('sell');
    }
    return saved;
  };

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  const handleLogout = async () => {
    logActivity('logout', 'Signed out', { staff });
    await endShift();
    clearCurrentStaff();
    setStaff(null);
  };
  const openView = (nextView, nextSettingsTab) => {
    if (nextSettingsTab) setSettingsTab(nextSettingsTab);
    setView(nextView);
  };
  const refreshMenu = async () => {
    const [m, c] = await Promise.all([loadMenu(), loadCategories()]);
    setMenu(m); setCategories(c);
  };

  if (loading) {
    return <div style={loadingStyle}>Loading...</div>;
  }

  // Gate 1 — the device must be linked to a restaurant (cloud) account.
  if (!cloudIn) {
    return <CloudLoginScreen onDone={() => setCloudIn(true)} />;
  }

  // Gate 2 — the restaurant's subscription/license must be valid (offline grace
  // is handled inside checkLicense, so this only triggers on a real lock).
  if (license.checked && !license.allowed) {
    return <LicenseLockScreen reason={license.reason} onRecheck={recheckLicense} onSwitch={unlinkDevice} />;
  }

  // Gate 3 — staff PIN sign-in (POS only; kiosk runs unattended). Opens a shift.
  if (!staff && !isKiosk) {
    return (
      <PinLockScreen
        title={cloudService.storeName() || 'Vido Food'}
        subtitle="Enter PIN to sign in"
        onUnlock={(s) => { setStaff(s); startShift(s); }}
      />
    );
  }

  if (isKiosk) {
    return (
      <ShopContext.Provider value={{ shop, updateShop }}>
        <div style={appStyle}>
          <style>{`
            @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .spin { animation: spin 1.5s linear infinite; }
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: var(--panel); }
            ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
          `}</style>
          <KioskOrderView
            menu={menu} categories={categories} staff={staff || KIOSK_STAFF}
            onExitKiosk={() => changeMode(MODE_POS)}
          />
        </div>
      </ShopContext.Provider>
    );
  }

  return (
    <ShopContext.Provider value={{ shop, updateShop }}>
      <OnlineOrdersProvider staff={staff}>
        <div style={appStyle}>
          <style>{`
            @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .spin { animation: spin 1.5s linear infinite; }
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: var(--panel); }
            ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
          `}</style>

          <TopBar
            view={view} openView={openView}
            theme={theme} toggleTheme={toggleTheme}
            staff={staff} onLogout={handleLogout}
            storeName={cloudService.storeName()} onUnlink={unlinkDevice}
          />

          <div style={contentStyle}>
            {view === 'sell' && <OrderView menu={menu} categories={categories} staff={staff} />}
            {view === 'kiosk' && <KioskOrderView menu={menu} categories={categories} staff={staff} />}
            {view === 'board' && <OrdersBoard />}
            {view === 'operations' && <OperationsView staff={staff} />}
            {view === 'orders' && <HistoryView />}
            {view === 'reports' && <ReportsView />}
            {view === 'settings' && (
              <SettingsView
                menu={menu} categories={categories}
                refreshMenu={refreshMenu} staff={staff}
                initialTab={settingsTab}
                mode={mode} changeMode={changeMode}
              />
            )}
          </div>

          {/* Full-screen takeover for incoming online orders (chime + Accept/Reject). */}
          <NewOrderTakeover />
        </div>
      </OnlineOrdersProvider>
    </ShopContext.Provider>
  );
}

// ============================================================================
// TOP BAR (inline component)
// ============================================================================
function TopBar({ view, openView, theme, toggleTheme, staff, onLogout, storeName, onUnlink }) {
  const { shop } = useShop();
  const [paxOnline, setPaxOnline] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mainMenuOpen, setMainMenuOpen] = useState(false);

  useEffect(() => {
    const check = async () => {
      const res = await paxService.ping();
      setPaxOnline(res.ok);
    };
    check();
    const i = setInterval(check, 30000);
    return () => clearInterval(i);
  }, []);

  const menuItems = [
    { id: 'sell', label: 'Sell / Order Entry', desc: 'Create tickets and take payment', icon: ShoppingCart, view: 'sell' },
    { id: 'board', label: 'Online Orders', desc: 'Incoming web & kiosk orders board', icon: ClipboardList, view: 'board' },
    { id: 'kiosk', label: 'Kiosk Mode', desc: 'Customer self-order screen', icon: Monitor, view: 'kiosk' },
    { id: 'operations', label: 'Operations', desc: 'Queue, closeout, refunds, devices', icon: Activity, view: 'operations' },
    { id: 'orders', label: 'Order History', desc: 'Look up completed receipts', icon: Receipt, view: 'orders' },
    { id: 'reports', label: 'Reports', desc: 'Sales, tender mix, staff totals', icon: BarChart3, view: 'reports' },
    { id: 'menu', label: 'Menu Items', desc: 'Items, categories, pricing', icon: Utensils, view: 'settings', tab: 'menu' },
    { id: 'staff', label: 'Staff & PINs', desc: 'Cashier and manager access', icon: Users, view: 'settings', tab: 'staff' },
    { id: 'pax', label: 'Payment Settings', desc: 'Card payment connection', icon: CreditCard, view: 'settings', tab: 'pax' },
    { id: 'hardware', label: 'Cash Drawer', desc: 'Drawer/printer hardware setup', icon: Archive, view: 'settings', tab: 'hardware' },
    { id: 'display', label: 'Customer Display', desc: 'Owner/customer screen setup', icon: Monitor, view: 'settings', tab: 'display' },
    { id: 'hub', label: 'Kiosk / Online Orders', desc: 'Connect kiosks and website orders to POS', icon: Wifi, view: 'settings', tab: 'hub' },
    { id: 'device', label: 'Device Mode', desc: 'Run this tablet as POS or Kiosk', icon: Monitor, view: 'settings', tab: 'device' },
    { id: 'shop', label: 'Shop Info', desc: 'Receipt header, tax, branch info', icon: Store, view: 'settings', tab: 'shop' },
    { id: 'settings', label: 'System Settings', desc: 'Version and diagnostics', icon: SettingsIcon, view: 'settings', tab: 'about' },
    { id: 'support', label: 'Daily Ops', desc: 'Use reports and order history for closeout', icon: LifeBuoy, view: 'reports' },
  ];
  const viewLabels = { sell: 'Sell', board: 'Online', kiosk: 'Kiosk', operations: 'Ops', orders: 'Orders', reports: 'Reports', settings: 'Settings' };

  const chooseMenuItem = (item) => {
    setMainMenuOpen(false);
    openView(item.view, item.tab);
  };

  return (
    <header style={tbStyles.header}>
      <div style={tbStyles.brand}>
        <BrandMark size={46} radius={12} style={{ marginRight: 12 }} />
        <div>
          <div style={tbStyles.brandName}>{shop.name}</div>
          <div style={tbStyles.brandSub}>{shop.branch}</div>
        </div>
      </div>

      <div style={tbStyles.menuWrap}>
        <button onClick={() => setMainMenuOpen(!mainMenuOpen)} style={tbStyles.menuBtn}>
          <MenuIcon size={18} />
          <span>Menu</span>
          <span style={tbStyles.currentView}>{viewLabels[view] || 'POS'}</span>
        </button>
        {mainMenuOpen && (
          <>
            <div onClick={() => setMainMenuOpen(false)} style={tbStyles.menuOverlay} />
            <div style={tbStyles.mainMenu}>
              {menuItems.map(item => {
                const Icon = item.icon;
                const active = view === item.view && (!item.tab || item.tab === 'pax');
                return (
                  <button key={item.id} onClick={() => chooseMenuItem(item)}
                    style={{ ...tbStyles.mainMenuItem, ...(active ? tbStyles.mainMenuItemActive : {}) }}>
                    <span style={tbStyles.mainMenuIcon}><Icon size={18} /></span>
                    <span>
                      <span style={tbStyles.mainMenuLabel}>{item.label}</span>
                      <span style={tbStyles.mainMenuDesc}>{item.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div style={tbStyles.meta}>
        <div style={{
          ...tbStyles.paxPill,
          background: paxOnline ? C.primaryA : C.redA,
          color: paxOnline ? C.primary : C.red,
        }}>
          {paxOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
          <span style={{ marginLeft: 5 }}>Payment {paxOnline ? 'Online' : 'Offline'}</span>
        </div>

        <button onClick={toggleTheme} style={tbStyles.themeBtn}>
          {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
        </button>

        <div style={{ position: 'relative' }}>
          <button onClick={() => setUserMenuOpen(!userMenuOpen)} style={tbStyles.userBtn}>
            <Avatar staff={staff} size={30} />
            <span style={tbStyles.userBtnText}>
              <span style={tbStyles.userBtnName}>{staff?.name || 'User'}</span>
              <span style={{
                ...tbStyles.userBtnRole,
                color: staff?.role === 'manager' ? C.primary : C.textMute,
              }}>{staff?.role || ''}</span>
            </span>
          </button>
          {userMenuOpen && (
            <>
              <div onClick={() => setUserMenuOpen(false)} style={tbStyles.menuOverlay} />
              <div style={tbStyles.userMenu}>
                <div style={tbStyles.userMenuInfo}>
                  <Avatar staff={staff} size={48} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{staff?.name}</div>
                    <div style={{ fontSize: 11, color: staff?.role === 'manager' ? C.primary : C.textMute, fontWeight: 800, marginTop: 2, textTransform: 'capitalize' }}>
                      {staff?.role}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, marginTop: 4 }}>
                      v{APP_VERSION} · #{BUILD_NUMBER === '__BUILD_NUMBER__' ? 'dev' : BUILD_NUMBER}
                    </div>
                  </div>
                </div>
                {storeName && (
                  <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 800, color: C.textMute, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Store size={12} /> {storeName}
                  </div>
                )}
                <button onClick={() => { setUserMenuOpen(false); onLogout(); }} style={tbStyles.userMenuItem}>
                  <LogOut size={14} /> Sign out
                </button>
                {onUnlink && (
                  <button onClick={() => { setUserMenuOpen(false); if (window.confirm('Unlink this device from the restaurant? You will need to sign in again.')) onUnlink(); }}
                    style={{ ...tbStyles.userMenuItem, color: C.red, borderTop: `1px solid ${C.border}` }}>
                    <WifiOff size={14} /> Unlink device
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const appStyle = {
  display: 'flex', flexDirection: 'column',
  height: '100vh', background: C.bg, color: C.text,
  overflow: 'hidden',
};
const contentStyle = { flex: 1, overflow: 'hidden', display: 'flex' };
const loadingStyle = {
  height: '100vh', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  background: C.bg, color: C.text,
  fontSize: 18, fontWeight: 800,
};

const tbStyles = {
  header: {
    background: C.panel, padding: '12px 20px',
    borderBottom: `1px solid ${C.border}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexShrink: 0,
  },
  brand: { display: 'flex', alignItems: 'center' },
  brandName: { fontSize: 20, fontWeight: 900, color: C.text },
  brandSub: { fontSize: 11, color: C.textMute, fontWeight: 700 },
  menuWrap: { position: 'relative' },
  menuBtn: {
    background: C.primaryG, color: C.bg, border: 'none',
    borderRadius: 12, padding: '9px 14px',
    cursor: 'pointer', fontWeight: 900, fontSize: 14,
    display: 'flex', alignItems: 'center', gap: 8,
    boxShadow: C.primaryGShadow,
  },
  currentView: {
    background: 'rgba(0,0,0,0.16)', padding: '3px 7px',
    borderRadius: 999, fontSize: 11,
  },
  meta: { display: 'flex', alignItems: 'center', gap: 8 },
  paxPill: {
    padding: '6px 12px', borderRadius: 999,
    fontWeight: 800, fontSize: 12,
    display: 'flex', alignItems: 'center',
  },
  themeBtn: {
    background: C.card, color: C.text, border: 'none',
    width: 32, height: 32, borderRadius: 999, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  userBtn: {
    background: C.card, color: C.text, border: `1px solid ${C.border}`,
    padding: '5px 12px 5px 5px', borderRadius: 999,
    cursor: 'pointer', fontWeight: 800, fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 9,
  },
  userBtnText: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 },
  userBtnName: { fontSize: 13, fontWeight: 900, color: C.text },
  userBtnRole: { fontSize: 10, fontWeight: 800, textTransform: 'capitalize', marginTop: 1 },
  menuOverlay: { position: 'fixed', inset: 0, zIndex: 99 },
  mainMenu: {
    position: 'absolute', top: '100%', left: '50%',
    transform: 'translateX(-50%)', marginTop: 8,
    width: 620, maxWidth: 'calc(100vw - 32px)',
    background: C.panel, border: `1px solid ${C.border}`,
    borderRadius: 14, padding: 10,
    boxShadow: `0 18px 50px ${C.shadow}`,
    zIndex: 100,
    display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  mainMenuItem: {
    background: C.card, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: 12, cursor: 'pointer',
    display: 'grid', gridTemplateColumns: '34px 1fr',
    gap: 10, textAlign: 'left', alignItems: 'center',
  },
  mainMenuItemActive: { borderColor: C.primary, background: C.primaryA },
  mainMenuIcon: {
    width: 34, height: 34, borderRadius: 8,
    background: C.panel, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    color: C.primary,
  },
  mainMenuLabel: { display: 'block', fontSize: 13, fontWeight: 900, color: C.text },
  mainMenuDesc: { display: 'block', fontSize: 11, fontWeight: 700, color: C.textMute, marginTop: 2, lineHeight: 1.25 },
  userMenu: {
    position: 'absolute', top: '100%', right: 0, marginTop: 6,
    background: C.panel, border: `1px solid ${C.border}`,
    borderRadius: 12, minWidth: 200,
    boxShadow: `0 10px 30px ${C.shadow}`,
    zIndex: 100, overflow: 'hidden',
  },
  userMenuInfo: { padding: '14px', borderBottom: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', gap: 12 },
  userMenuItem: {
    width: '100%', background: 'transparent', color: C.text,
    border: 'none', padding: '10px 14px',
    fontSize: 13, fontWeight: 700, textAlign: 'left', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 8,
  },
};

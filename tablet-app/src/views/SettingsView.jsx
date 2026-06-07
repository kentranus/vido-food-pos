import React, { useState, useEffect } from 'react';
import {
  Plus, Edit3, Trash2, Save, Check, X, RefreshCw, WifiOff, Monitor, Store,
} from 'lucide-react';
import { C } from '../theme';
import { SHOP, formatUSD } from '../config';
import { paxService, getDebugLog, clearDebugLog, PAX_STATUS } from '../services/paxBridge';
import { hardwareService } from '../services/hardwareBridge';
import { customerDisplayService } from '../services/customerDisplayBridge';
import { orderHubService } from '../services/orderHubService';
import { embeddedHub, HUB_PORT } from '../services/embeddedHub';
import { saveMenu, saveCategories, resetMenuToDefaults } from '../services/menuStorage';
import { loadStaff, addStaff, updateStaff, deleteStaff } from '../services/staffStorage';
import { APP_VERSION, BUILD_DATE, BUILD_NUMBER, COMMIT_SHORT } from '../version';
import { DEFAULT_MENU } from '../data/defaultMenu';
import { Modal, ModalClose, Button, Input, Field, PinLockScreen, BrandMark, Avatar } from '../components/Shared';
import { useShop } from '../App';

export function SettingsView({ menu, categories, refreshMenu, staff, initialTab = 'pax', mode, changeMode }) {
  const [tab, setTab] = useState(initialTab);
  const [needsManagerPin, setNeedsManagerPin] = useState(false);
  const [unlockedTab, setUnlockedTab] = useState(null);

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const requiresManager = (tabId) => ['staff', 'pax', 'hardware', 'display', 'hub', 'device'].includes(tabId);

  const switchTab = (tabId) => {
    if (requiresManager(tabId) && staff.role !== 'manager' && unlockedTab !== tabId) {
      setNeedsManagerPin(tabId);
    } else {
      setTab(tabId);
    }
  };

  return (
    <div style={s.container}>
      <div style={s.title}>Settings</div>

      <div style={s.tabs}>
        {[
          { id: 'pax',   label: 'Payment Settings', requiresMgr: true },
          { id: 'hardware', label: 'Hardware', requiresMgr: true },
          { id: 'display', label: 'Displays', requiresMgr: true },
          { id: 'hub', label: 'Kiosk / Online', requiresMgr: true },
          { id: 'menu',  label: 'Menu Editor' },
          { id: 'staff', label: 'Staff', requiresMgr: true },
          { id: 'shop',  label: 'Shop Info' },
          { id: 'device', label: 'Device Mode', requiresMgr: true },
          { id: 'about', label: 'About' },
        ].map(t => (
          <button key={t.id}
            onClick={() => switchTab(t.id)}
            style={{
              padding: '8px 18px', fontWeight: 800, fontSize: 13,
              borderRadius: 8, border: 'none',
              background: tab === t.id ? C.primary : 'transparent',
              color: tab === t.id ? C.bg : C.textMute,
              cursor: 'pointer',
            }}>
            {t.label}
            {t.requiresMgr && staff.role !== 'manager' && (
              <span style={{ marginLeft: 4, fontSize: 10 }}>🔒</span>
            )}
          </button>
        ))}
      </div>

      <div style={s.tabContent}>
        {tab === 'pax' && <PaxSettings />}
        {tab === 'hardware' && <HardwareSettings />}
        {tab === 'display' && <DisplaySettings />}
        {tab === 'hub' && <HubSettings />}
        {tab === 'menu' && <MenuEditor menu={menu} categories={categories} refreshMenu={refreshMenu} />}
        {tab === 'staff' && <StaffManager />}
        {tab === 'shop' && <ShopInfo />}
        {tab === 'device' && <DeviceModeSettings mode={mode} changeMode={changeMode} />}
        {tab === 'about' && <AboutTab />}
      </div>

      {needsManagerPin && (
        <PinLockScreen
          title="Manager PIN"
          subtitle="Required to access this section"
          managerOnly={true}
          fullScreen={false}
          onUnlock={() => {
            setUnlockedTab(needsManagerPin);
            setTab(needsManagerPin);
            setNeedsManagerPin(false);
          }}
          onCancel={() => setNeedsManagerPin(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// PAYMENT SETTINGS — with protocol config, debug log, test sale
// ============================================================================
function PaxSettings() {
  const [cfg, setCfg] = useState({ ...paxService.config });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [testSaleRunning, setTestSaleRunning] = useState(false);
  const [testSaleResult, setTestSaleResult] = useState(null);
  const [log, setLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let alive = true;
    paxService.ready.then(() => {
      if (alive) setCfg({ ...paxService.config });
    });
    return () => { alive = false; };
  }, []);

  // Refresh log periodically while open
  useEffect(() => {
    const i = setInterval(() => setLog(getDebugLog()), 1000);
    return () => clearInterval(i);
  }, []);

  const test = async () => {
    setTesting(true);
    setResult(null);
    await paxService.updateConfig(cfg);
    const r = await paxService.ping();
    setTesting(false);
    setResult(r);
    setLog(getDebugLog());
  };

  const save = async () => {
    setResult(null);
    try {
      await paxService.updateConfig(cfg);
      setCfg({ ...paxService.config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setResult({ ok: false, error: e.message || 'Could not save payment settings' });
    }
  };

  const runTestSale = async () => {
    if (!confirm('Run TEST SALE of $0.01? The card terminal will activate. Card holder can cancel on the terminal. This is a real transaction if approved!')) return;
    setTestSaleRunning(true);
    setTestSaleResult(null);
    await paxService.updateConfig(cfg);
    try {
      const r = await paxService.sale(0.01, 'TEST' + Date.now().toString().slice(-6));
      setTestSaleResult({ ok: r.status.id === 'approved', detail: r });
    } catch (e) {
      setTestSaleResult({ ok: false, detail: { error: e.message } });
    } finally {
      setTestSaleRunning(false);
      setLog(getDebugLog());
    }
  };

  const applyPaxPreset = (preset) => {
    if (preset === 'common') {
      setCfg({
        ...cfg,
        protocolVersion: '1.28',
        separator: '|',
        useLengthPrefix: false,
        lengthEndian: 'little',
        useLRC: true,
        tipRequest: false,
      });
      return;
    }
    if (preset === 'tip') {
      setCfg({
        ...cfg,
        protocolVersion: '1.28',
        separator: '|',
        useLengthPrefix: false,
        lengthEndian: 'little',
        useLRC: true,
        tipRequest: true,
      });
      return;
    }
    if (preset === 'legacy') {
      setCfg({
        ...cfg,
        protocolVersion: '1.28',
        separator: String.fromCharCode(0x1C),
        useLengthPrefix: false,
        lengthEndian: 'little',
        useLRC: true,
        tipRequest: false,
      });
      return;
    }
    if (preset === 'framed') {
      setCfg({
        ...cfg,
        protocolVersion: '1.28',
        separator: '|',
        useLengthPrefix: true,
        lengthEndian: 'little',
        useLRC: true,
        tipRequest: false,
      });
      return;
    }
    if (preset === 'nolrc') {
      setCfg({
        ...cfg,
        protocolVersion: '1.28',
        separator: '|',
        useLengthPrefix: false,
        lengthEndian: 'little',
        useLRC: false,
        tipRequest: false,
      });
      return;
    }
    if (preset === 'framedNoLrc') {
      setCfg({
        ...cfg,
        protocolVersion: '1.28',
        separator: '|',
        useLengthPrefix: true,
        lengthEndian: 'little',
        useLRC: false,
        tipRequest: false,
      });
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Payment Connection
        </div>
        <Field label="Connection Type">
          <select value={cfg.connectionMode || 'tcp'}
            onChange={e => setCfg({ ...cfg, connectionMode: e.target.value })}
            style={{
              width: '100%', padding: '12px 14px',
              background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              fontSize: 15, fontWeight: 800, fontFamily: 'inherit',
            }}>
            <option value="tcp">TCP/IP</option>
            <option value="serial">Serial Number</option>
            <option value="usb">USB</option>
          </select>
        </Field>

        {(cfg.connectionMode || 'tcp') === 'tcp' && (
          <>
            <Field label="Terminal IP Address">
              <Input value={cfg.ip} placeholder="192.168.68.59"
                onChange={e => setCfg({ ...cfg, ip: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Field label="Port">
                  <Input type="number" value={cfg.port}
                    onChange={e => setCfg({ ...cfg, port: parseInt(e.target.value) || 10009 })} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Timeout">
                  <Input type="number" value={cfg.timeout}
                    onChange={e => setCfg({ ...cfg, timeout: parseInt(e.target.value) || 60000 })} />
                </Field>
              </div>
            </div>
          </>
        )}

        {(cfg.connectionMode || 'tcp') === 'serial' && (
          <Field label="Terminal Serial Number">
            <Input value={cfg.terminalSerial || ''} placeholder="Enter terminal serial number"
              onChange={e => setCfg({ ...cfg, terminalSerial: e.target.value })} />
          </Field>
        )}

        {(cfg.connectionMode || 'tcp') === 'usb' && (
          <div style={{
            padding: 14, borderRadius: 10,
            background: C.card, border: `1px solid ${C.border}`,
            color: C.text, fontWeight: 800, fontSize: 14,
          }}>
            USB connection selected
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={test} disabled={testing || ((cfg.connectionMode || 'tcp') === 'tcp' && !cfg.ip)}>
          {testing ? <><RefreshCw size={14} className="spin" /> Testing...</> : 'Test Connection'}
        </Button>
        <Button onClick={save}>
          {saved ? <><Check size={14} /> Saved</> : 'Save'}
        </Button>
        <Button
          variant="danger"
          onClick={runTestSale}
          disabled={testSaleRunning || ((cfg.connectionMode || 'tcp') === 'tcp' && !cfg.ip)}
          style={{ background: C.yellow, color: C.bg }}>
          {testSaleRunning ? <><RefreshCw size={14} className="spin" /> Running...</> : 'Test Sale $0.01'}
        </Button>
      </div>

      <Button size="sm" variant="ghost" onClick={() => setShowAdvanced(!showAdvanced)} style={{ marginBottom: 14 }}>
        {showAdvanced ? 'Hide Advanced' : 'Advanced Debug'}
      </Button>

      {showAdvanced && (
	      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 14 }}>
	        <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
	          BroadPOS Fallback / Debug
	        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 13, color: C.text, marginBottom: 12 }}>
          <input type="checkbox" checked={cfg.usePosLinkSdk !== false}
            onChange={e => setCfg({ ...cfg, usePosLinkSdk: e.target.checked })} />
          Use official POSLink SDK
        </label>
        <Field label="Retry Attempts" hint="Resends request if terminal returns NAK">
          <Input type="number" min="1" max="5" value={cfg.maxRetries || 3}
            onChange={e => setCfg({ ...cfg, maxRetries: parseInt(e.target.value) || 3 })} />
        </Field>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <Button size="sm" variant="ghost" onClick={() => applyPaxPreset('common')}>
            Common Preset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => applyPaxPreset('framed')}>
            Framed Preset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => applyPaxPreset('tip')}>
            Common + Tip
          </Button>
          <Button size="sm" variant="ghost" onClick={() => applyPaxPreset('legacy')}>
            Legacy FS Preset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => applyPaxPreset('nolrc')}>
            No LRC Preset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => applyPaxPreset('framedNoLrc')}>
            Framed No LRC
          </Button>
        </div>
	        <Field label="Protocol Version" hint="Match your BroadPOS version (1.28, 1.29, 2.0)">
          <Input value={cfg.protocolVersion || '1.28'}
            onChange={e => setCfg({ ...cfg, protocolVersion: e.target.value })} />
        </Field>
        <Field label="Field Separator" hint="Most BroadPOS use '|' (pipe). Some older use FS (0x1C).">
          <select value={cfg.separator || '|'}
            onChange={e => setCfg({ ...cfg, separator: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            }}>
            <option value="|">| (pipe) — standard</option>
            <option value={String.fromCharCode(0x1C)}>FS (0x1C) — older variant</option>
          </select>
        </Field>
        <Field label="Length Prefix Byte Order" hint="Only used when Length Prefix is checked">
          <select value={cfg.lengthEndian || 'little'}
            onChange={e => setCfg({ ...cfg, lengthEndian: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            }}>
            <option value="little">Little endian</option>
            <option value="big">Big endian</option>
          </select>
        </Field>
	        <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
	          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: C.text }}>
	            <input type="checkbox" checked={cfg.useLengthPrefix !== false}
	              onChange={e => setCfg({ ...cfg, useLengthPrefix: e.target.checked })} />
	            Length Prefix (2 bytes after STX)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={cfg.useLRC !== false}
              onChange={e => setCfg({ ...cfg, useLRC: e.target.checked })} />
	            LRC checksum
	          </label>
	          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: C.text }}>
	            <input type="checkbox" checked={cfg.tipRequest !== false}
	              onChange={e => setCfg({ ...cfg, tipRequest: e.target.checked })} />
	            Ask tip on card terminal
	          </label>
	        </div>
	      </div>
      )}

      {result && (
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          fontWeight: 700, fontSize: 13,
          background: result.ok ? C.primaryA : C.redA,
          color: result.ok ? C.primary : C.red,
          marginBottom: 12,
        }}>
          {result.ok ? `✓ Connected: ${result.model}` : `✗ Failed: ${result.error}`}
        </div>
      )}

      {testSaleResult && (
        <div style={{
          padding: 14, borderRadius: 10,
          background: testSaleResult.ok ? C.primaryA : C.redA,
          color: testSaleResult.ok ? C.primary : C.red,
          marginBottom: 12, fontSize: 13, fontWeight: 700,
        }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>
            {testSaleResult.ok ? '✓ Test Sale APPROVED' : '✗ Test Sale FAILED'}
          </div>
          <pre style={{ fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: 0 }}>
            {JSON.stringify(testSaleResult.detail, null, 2)}
          </pre>
        </div>
      )}

      {/* DEBUG LOG */}
      <div style={{ background: C.panel, padding: 18, borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Debug Log ({log.length})
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={() => setShowLog(!showLog)}>
              {showLog ? 'Hide' : 'Show'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { clearDebugLog(); setLog([]); }}>Clear</Button>
          </div>
        </div>
        {showLog ? (
          <div style={{ maxHeight: 360, overflowY: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
            {log.length === 0 ? (
              <div style={{ color: C.textDim, padding: 12, textAlign: 'center' }}>
                No events yet. Try Test Connection or Test Sale.
              </div>
            ) : log.map((e, i) => (
              <div key={i} style={{
                padding: '8px 10px',
                borderBottom: `1px solid ${C.border}`,
                background: e.type === 'error' ? C.redA : e.type === 'tx' ? 'rgba(59,130,246,0.08)' : e.type === 'rx' ? C.primaryA : 'transparent',
              }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    background: e.type === 'error' ? C.red : e.type === 'tx' ? C.blue : e.type === 'rx' ? C.primary : C.textMute,
                    color: e.type === 'rx' ? C.bg : '#fff',
                    padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 800,
                  }}>
                    {e.type.toUpperCase()}
                  </span>
                  <span style={{ color: C.textMute, fontSize: 10 }}>{new Date(e.time).toLocaleTimeString()}</span>
                  <span style={{ color: C.text, fontWeight: 700 }}>{e.message}</span>
                </div>
                {e.hex && (
                  <div style={{ marginLeft: 4, color: C.textMute }}>
                    <div>HEX: <span style={{ color: C.text }}>{e.hex}</span></div>
                    <div>ASCII: <span style={{ color: C.text }}>{e.ascii}</span></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700 }}>
            Show log to see raw TCP traffic (TX/RX bytes in HEX + ASCII).
            Use this to verify protocol format with payment terminal support.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// POS HUB SETTINGS — kiosk and online order bridge
// ============================================================================
function HubSettings() {
  const [cfg, setCfg] = useState({ ...orderHubService.config });
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingTerminal, setTestingTerminal] = useState(false);
  const [result, setResult] = useState(null);
  const [terminalResult, setTerminalResult] = useState(null);
  const [hub, setHub] = useState({ running: false, supported: false, ip: '', port: HUB_PORT });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const st = await embeddedHub.status();
      if (alive) setHub(st);
    };
    refresh();
    const t = setInterval(refresh, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let alive = true;
    orderHubService.ready.then(() => {
      if (alive) setCfg({ ...orderHubService.config });
    });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    const next = await orderHubService.updateConfig(cfg);
    setCfg({ ...next });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    const next = await orderHubService.updateConfig(cfg);
    const r = await orderHubService.ping(next);
    setTesting(false);
    setResult(r);
  };

  const updateKioskPax = (patch) => {
    setCfg({ ...cfg, kioskPax: { ...(cfg.kioskPax || {}), ...patch } });
  };

  const testKioskTerminal = async () => {
    const kioskPax = { ...(cfg.kioskPax || {}) };
    setTerminalResult(null);
    if ((kioskPax.connectionMode || 'tcp') === 'tcp' && !String(kioskPax.ip || '').trim()) {
      setTerminalResult({ ok: false, error: 'Enter kiosk PAX IP first' });
      return;
    }
    setTestingTerminal(true);
    await orderHubService.updateConfig(cfg);
    const oldPax = { ...paxService.config };
    try {
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
      const r = await paxService.ping();
      setTerminalResult(r);
    } catch (e) {
      setTerminalResult({ ok: false, error: e.message || 'Terminal test failed' });
    } finally {
      await paxService.updateConfig(oldPax);
      setTestingTerminal(false);
    }
  };

  const kioskPax = { ...(orderHubService.config.kioskPax || {}), ...(cfg.kioskPax || {}) };

  return (
    <div style={{ maxWidth: 760 }}>
      {hub.supported && (
        <div style={{
          background: hub.running ? 'rgba(74,222,128,0.10)' : C.panel,
          border: `1px solid ${hub.running ? C.green : C.border}`,
          padding: 18, borderRadius: 12, marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 900, color: hub.running ? C.green : C.textMute, marginBottom: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: hub.running ? C.green : C.textMute, display: 'inline-block' }} />
            {hub.running ? 'This POS is the hub — running' : 'Hub starting…'}
          </div>
          <div style={{ fontSize: 13, color: C.textMute, fontWeight: 700, marginBottom: 6 }}>
            On each kiosk, enter this address as the POS address:
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: C.text, letterSpacing: 0.5, userSelect: 'all' }}>
            {hub.ip ? `${hub.ip}:${hub.port}` : 'Connect Wi-Fi to get address'}
          </div>
          <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginTop: 8 }}>
            Kiosks and this POS must be on the same Wi-Fi. Tip: give this tablet a fixed IP in the router so the address never changes.
          </div>
        </div>
      )}

      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          {hub.supported ? 'Advanced — receiving options' : 'POS Hub for kiosk and online orders'}
        </div>
        {!hub.supported && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 15, fontWeight: 900, marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={!!cfg.enabled}
                onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}
              />
              Enable POS Hub connection
            </label>
            <Field
              label="POS Hub URL"
              hint="Only needed if you run the hub on a separate computer instead of this tablet"
            >
              <Input
                value={cfg.hubUrl || ''}
                placeholder="http://192.168.1.50:8787"
                onChange={e => setCfg({ ...cfg, hubUrl: e.target.value })}
              />
            </Field>
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Store ID">
            <Input value={cfg.storeId || ''} onChange={e => setCfg({ ...cfg, storeId: e.target.value })} />
          </Field>
          <Field label="This Device ID">
            <Input value={cfg.stationId || ''} onChange={e => setCfg({ ...cfg, stationId: e.target.value })} />
          </Field>
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
          <label style={s.checkLine}>
            <input type="checkbox" checked={!!cfg.autoAcceptKioskOrders}
              onChange={e => setCfg({ ...cfg, autoAcceptKioskOrders: e.target.checked })} />
            Auto accept paid kiosk / online orders on this POS
          </label>
          <label style={s.checkLine}>
            <input type="checkbox" checked={!!cfg.autoPrintKitchenTickets}
              onChange={e => setCfg({ ...cfg, autoPrintKitchenTickets: e.target.checked })} />
            Auto print kitchen/drink ticket after POS receives paid order
          </label>
          <label style={s.checkLine}>
            <input type="checkbox" checked={!!cfg.autoPrintCustomerReceipts}
              onChange={e => setCfg({ ...cfg, autoPrintCustomerReceipts: e.target.checked })} />
            Auto print customer receipt for kiosk orders
          </label>
        </div>
      </div>

      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Kiosk payment terminal
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 15, fontWeight: 900, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={kioskPax.enabled !== false}
            onChange={e => updateKioskPax({ enabled: e.target.checked })}
          />
          Enable separate PAX terminal for kiosk Pay Now
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Connection">
            <select
              value={kioskPax.connectionMode || 'tcp'}
              onChange={e => updateKioskPax({ connectionMode: e.target.value })}
              style={s.select}
            >
              <option value="tcp">TCP/IP</option>
              <option value="usb">USB via POSLink SDK</option>
              <option value="serial">Serial number</option>
            </select>
          </Field>
          <Field label="PAX terminal IP">
            <Input
              value={kioskPax.ip || ''}
              placeholder="192.168.68.59"
              disabled={(kioskPax.connectionMode || 'tcp') !== 'tcp'}
              onChange={e => updateKioskPax({ ip: e.target.value })}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Port" hint="Most BroadPOS terminals use 10009">
            <Input
              value={kioskPax.port || 10009}
              type="number"
              disabled={(kioskPax.connectionMode || 'tcp') !== 'tcp'}
              onChange={e => updateKioskPax({ port: Number(e.target.value || 10009) })}
            />
          </Field>
          <Field label="Timeout (ms)" hint="60000 = 60 seconds">
            <Input
              value={kioskPax.timeout || 60000}
              type="number"
              onChange={e => updateKioskPax({ timeout: Number(e.target.value || 60000) })}
            />
          </Field>
        </div>
        {(kioskPax.connectionMode || 'tcp') === 'usb' && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 10,
            marginBottom: 12,
            background: 'rgba(252, 211, 77, 0.10)',
            color: C.text,
            fontSize: 12,
            fontWeight: 800,
            lineHeight: 1.5,
          }}>
            USB mode does not use IP or port. On the Android kiosk, connect the PAX terminal by USB,
            allow USB permission, and keep POSLink SDK enabled.
          </div>
        )}
        {(kioskPax.connectionMode || 'tcp') === 'serial' && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 10,
            marginBottom: 12,
            background: 'rgba(252, 211, 77, 0.10)',
            color: C.text,
            fontSize: 12,
            fontWeight: 800,
            lineHeight: 1.5,
          }}>
            Serial pairing is saved here for future support. For live payment today, use TCP/IP or USB.
          </div>
        )}
        <Field label="Terminal serial number" hint="Optional. Use only if your PAX setup pairs by serial instead of TCP/IP.">
          <Input
            value={kioskPax.terminalSerial || ''}
            placeholder="Optional"
            onChange={e => updateKioskPax({ terminalSerial: e.target.value })}
          />
        </Field>
        <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
          <label style={s.checkLine}>
            <input type="checkbox" checked={kioskPax.tipRequest !== false}
              onChange={e => updateKioskPax({ tipRequest: e.target.checked })} />
            Show tip on PAX terminal when kiosk uses Pay Now
          </label>
          <label style={s.checkLine}>
            <input type="checkbox" checked={kioskPax.usePosLinkSdk !== false}
              onChange={e => updateKioskPax({ usePosLinkSdk: e.target.checked })} />
            Use PAX POSLink SDK in Android build
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <Button variant="ghost" onClick={testKioskTerminal} disabled={testingTerminal || kioskPax.enabled === false}>
            {testingTerminal ? <><RefreshCw size={14} className="spin" /> Testing...</> : `Test Kiosk PAX (${(kioskPax.connectionMode || 'tcp').toUpperCase()})`}
          </Button>
        </div>
        {terminalResult && (
          <div style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 900,
            color: terminalResult.ok ? C.green : C.red,
            background: terminalResult.ok ? 'rgba(74,222,128,0.12)' : C.redA,
          }}>
            {terminalResult.ok
              ? `Kiosk terminal connected${terminalResult.web ? ' (web preview simulated)' : ''}`
              : `Kiosk terminal failed: ${terminalResult.error}`}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Button variant="ghost" onClick={test} disabled={testing || !cfg.hubUrl}>
          {testing ? <><RefreshCw size={14} className="spin" /> Testing...</> : 'Test POS Hub'}
        </Button>
        <Button onClick={save}>
          {saved ? <><Check size={14} /> Saved</> : 'Save Kiosk / Online Settings'}
        </Button>
      </div>

      {result && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 900,
          color: result.ok ? C.green : C.red,
          background: result.ok ? 'rgba(74,222,128,0.12)' : C.redA,
        }}>
          {result.ok ? `Connected to ${result.service}` : `Failed: ${result.error}`}
        </div>
      )}

      <div style={{ marginTop: 14, color: C.textMute, fontSize: 13, fontWeight: 800, lineHeight: 1.6 }}>
        Each kiosk can use its own PAX IP/port above. After PAX approves payment, the kiosk sends the paid order to this POS Hub. The POS receives it in Operations, shares one order number, and prints the ticket.
      </div>
    </div>
  );
}

// ============================================================================
// DISPLAY SETTINGS
// ============================================================================
function DisplaySettings() {
  const [cfg, setCfg] = useState({ ...customerDisplayService.config });
  const [displays, setDisplays] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      const list = await customerDisplayService.listDisplays();
      setDisplays(list);
      setCfg({ ...customerDisplayService.config });
    } catch (e) {
      setMessage(e.message || 'Could not read displays');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const secondary = displays.filter(d => !d.isPrimary);
  const hasSecondary = secondary.length > 0;

  const runAuto = async () => {
    setBusy(true);
    setMessage('');
    try {
      const next = await customerDisplayService.autoConfigure();
      setDisplays(next.displays || []);
      setCfg({ ...customerDisplayService.config });
      setMessage(next.hasSecondary
        ? 'Customer display is available'
        : 'Only one Android screen detected. Customer display turned off automatically.');
    } catch (e) {
      setMessage(e.message || 'Auto setup failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (enabled) => {
    setBusy(true);
    setMessage('');
    try {
      const r = await customerDisplayService.setEnabled(enabled);
      setCfg({ ...customerDisplayService.config });
      setMessage(r.ok === false ? r.error : (enabled ? 'Customer display turned on' : 'Customer display turned off'));
    } catch (e) {
      setMessage(e.message || 'Display update failed');
    } finally {
      setBusy(false);
    }
  };

  const save = async (updates) => {
    const next = await customerDisplayService.updateConfig({ ...cfg, ...updates });
    setCfg({ ...next });
  };

  const test = async () => {
    setBusy(true);
    setMessage('');
    try {
      await customerDisplayService.update({
        state: 'order',
        shop: { name: 'My Shop', currencySymbol: '$' },
        orderNumber: 1001,
        items: [
          { name: 'Signature Milk Tea', emoji: '🧋', details: 'Large · 50% sugar', qty: 2, total: 11.98 },
          { name: 'Iced Coffee', emoji: '☕', details: 'Regular', qty: 1, total: 4.25 },
        ],
        subtotal: 16.23,
        discount: 0,
        tax: 1.30,
        total: 17.53,
      });
      setMessage('Test order sent to customer display');
    } catch (e) {
      setMessage(e.message || 'Test failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Monitor size={22} color={C.primary} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>Owner / Customer Screens</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMute, marginTop: 2 }}>
              Auto off on one-screen Android tablets. Auto on when a customer screen is detected.
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 900, color: C.text }}>
            <input
              type="checkbox"
              checked={cfg.enabled}
              disabled={busy || !hasSecondary}
              onChange={e => toggleEnabled(e.target.checked)}
            />
            On
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={cfg.autoManage !== false}
            onChange={async e => {
              await save({ autoManage: e.target.checked });
              if (e.target.checked) runAuto();
            }}
          />
          Auto detect and manage customer display
        </label>

        <div style={{
          padding: 12, borderRadius: 10,
          background: hasSecondary ? C.primaryA : C.redA,
          color: hasSecondary ? C.primary : C.red,
          fontSize: 13, fontWeight: 900, marginBottom: 14,
        }}>
          Detected {displays.length} screen{displays.length === 1 ? '' : 's'}
          {!hasSecondary ? ' — customer screen disabled' : ' — customer screen available'}
        </div>

        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {displays.map(d => (
            <button key={d.id}
              disabled={d.isPrimary}
              onClick={async () => {
                await save({ displayId: d.id });
                if (cfg.enabled) await customerDisplayService.show(d.id);
              }}
              style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 10,
                border: `1px solid ${cfg.displayId === d.id ? C.primary : C.border}`,
                background: cfg.displayId === d.id ? C.primaryA : C.card,
                color: C.text, cursor: d.isPrimary ? 'default' : 'pointer',
              }}>
              <div style={{ fontSize: 14, fontWeight: 900 }}>
                {d.name} {d.isPrimary ? '(Owner screen)' : '(Customer screen)'}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMute, marginTop: 3 }}>
                ID {d.id}{d.width ? ` · ${d.width}×${d.height}` : ''}{d.isPresentation ? ' · Presentation' : ''}
              </div>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={refresh} disabled={busy}>
            {busy ? <><RefreshCw size={14} className="spin" /> Reading...</> : 'Refresh'}
          </Button>
          <Button onClick={runAuto} disabled={busy}>Auto Setup</Button>
          <Button variant="ghost" onClick={test} disabled={busy || !cfg.enabled}>Test Customer Screen</Button>
        </div>

        {message && (
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 800, color: message.toLowerCase().includes('failed') ? C.red : C.textMute }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// HARDWARE SETTINGS
// ============================================================================
function HardwareSettings() {
  const [cfg, setCfg] = useState({ ...hardwareService.config });
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [usbDevices, setUsbDevices] = useState([]);

  useEffect(() => {
    hardwareService.ready.then(() => setCfg({ ...hardwareService.config }));
    hardwareService.getDeviceInfo()
      .then(setDeviceInfo)
      .catch(e => setDeviceInfo({ error: e.message }));
    scanUsbDevices();
  }, []);

  const scanUsbDevices = async () => {
    try {
      const r = await hardwareService.listUsbDevices();
      setUsbDevices(r.devices || []);
    } catch (e) {
      setUsbDevices([{ error: e.message }]);
    }
  };

  const save = async () => {
    await hardwareService.updateConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const testDrawer = async () => {
    setTesting(true);
    setResult(null);
    try {
      await hardwareService.updateConfig(cfg);
      const r = await hardwareService.openCashDrawer();
      setResult({ ok: true, detail: r });
    } catch (e) {
      setResult({ ok: false, detail: { error: e.message } });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{
        background: C.primaryA, border: `1px solid ${C.primary}33`,
        padding: 14, borderRadius: 12, marginBottom: 18,
        fontSize: 13, color: C.primary, fontWeight: 700,
      }}>
        Configure the cash drawer button on the main selling screen. Use USB or Network ESC/POS when the drawer is connected to a receipt printer.
      </div>

      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          POS Device Info
        </div>
        {deviceInfo ? (
          <pre style={{
            margin: 0, padding: 12, borderRadius: 10,
            background: C.card, color: C.text,
            fontSize: 12, fontFamily: 'ui-monospace, monospace',
            whiteSpace: 'pre-wrap',
          }}>{JSON.stringify(deviceInfo, null, 2)}</pre>
        ) : (
          <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700 }}>Reading device info...</div>
        )}
      </div>

      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Cash Drawer Connection
        </div>
        <Field label="Drawer Mode">
          <select value={cfg.cashDrawerMode || 'android_intent'}
            onChange={e => setCfg({ ...cfg, cashDrawerMode: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            }}>
            <option value="android_intent">Android POS built-in drawer intent</option>
            <option value="usb_escpos">USB ESC/POS printer pulse</option>
            <option value="network_escpos">Network ESC/POS printer pulse</option>
          </select>
        </Field>

        {cfg.cashDrawerMode === 'android_intent' ? (
          <Field label="Custom Intent Action" hint="Optional. Leave blank unless your POS vendor gives a specific cash drawer action.">
            <Input value={cfg.customIntentAction || ''}
              placeholder="e.g. com.vendor.cashdrawer.OPEN"
              onChange={e => setCfg({ ...cfg, customIntentAction: e.target.value })} />
          </Field>
        ) : cfg.cashDrawerMode === 'usb_escpos' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase' }}>
                USB Printers ({usbDevices.length})
              </div>
              <Button size="sm" variant="ghost" onClick={scanUsbDevices}>Scan USB Devices</Button>
            </div>
            <div style={{ background: C.card, borderRadius: 10, padding: 10, marginBottom: 14 }}>
              {usbDevices.length === 0 ? (
                <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700 }}>No USB devices found yet.</div>
              ) : usbDevices.map((d, i) => (
                <button key={i}
                  onClick={() => setCfg({ ...cfg, usbVendorId: d.vendorId || 0, usbProductId: d.productId || 0 })}
                  style={{
                    width: '100%', background: d.vendorId === cfg.usbVendorId && d.productId === cfg.usbProductId ? C.primaryA : 'transparent',
                    color: C.text, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: 10, marginBottom: i === usbDevices.length - 1 ? 0 : 8,
                    cursor: 'pointer', textAlign: 'left', fontWeight: 700,
                  }}>
                  {d.error ? (
                    <span style={{ color: C.red }}>{d.error}</span>
                  ) : (
                    <>
                      <div>{d.productName || d.deviceName || 'USB Device'}</div>
                      <div style={{ fontSize: 11, color: C.textMute, marginTop: 3 }}>
                        VID {d.vendorId} / PID {d.productId} / Permission {d.hasPermission ? 'yes' : 'no'}
                      </div>
                    </>
                  )}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Field label="USB Vendor ID" hint="0 = auto-detect first USB printer.">
                  <Input type="number" value={cfg.usbVendorId || 0}
                    onChange={e => setCfg({ ...cfg, usbVendorId: parseInt(e.target.value) || 0 })} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="USB Product ID">
                  <Input type="number" value={cfg.usbProductId || 0}
                    onChange={e => setCfg({ ...cfg, usbProductId: parseInt(e.target.value) || 0 })} />
                </Field>
              </div>
            </div>
            <Field label="Pulse Pin" hint="0 is common. Try 1 if drawer does not open.">
              <Input type="number" value={cfg.pulsePin || 0}
                onChange={e => setCfg({ ...cfg, pulsePin: parseInt(e.target.value) || 0 })} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Printer IP Address" hint="The receipt printer IP that the cash drawer plugs into.">
              <Input value={cfg.printerHost || ''}
                placeholder="e.g. 192.168.1.50"
                onChange={e => setCfg({ ...cfg, printerHost: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Field label="Printer Port">
                  <Input type="number" value={cfg.printerPort || 9100}
                    onChange={e => setCfg({ ...cfg, printerPort: parseInt(e.target.value) || 9100 })} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Pulse Pin" hint="0 is common. Try 1 if drawer does not open.">
                  <Input type="number" value={cfg.pulsePin || 0}
                    onChange={e => setCfg({ ...cfg, pulsePin: parseInt(e.target.value) || 0 })} />
                </Field>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Button onClick={save}>{saved ? 'Saved' : 'Save Hardware Settings'}</Button>
        <Button variant="ghost" onClick={testDrawer} disabled={testing}>
          {testing ? <><RefreshCw size={14} className="spin" /> Opening...</> : 'Test Open Drawer'}
        </Button>
      </div>

      {result && (
        <div style={{
          padding: 14, borderRadius: 10,
          background: result.ok ? C.primaryA : C.redA,
          color: result.ok ? C.primary : C.red,
          fontSize: 13, fontWeight: 700,
        }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>
            {result.ok ? 'Cash drawer command sent' : 'Cash drawer failed'}
          </div>
          <pre style={{ fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: 0 }}>
            {JSON.stringify(result.detail, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MENU EDITOR
// ============================================================================
function MenuEditor({ menu, categories, refreshMenu }) {
  const [editing, setEditing] = useState(null);
  const [editingCat, setEditingCat] = useState(null);
  const [showCatModal, setShowCatModal] = useState(false);

  const saveItem = async (item) => {
    const m = item.id && menu.some(x => x.id === item.id)
      ? menu.map(x => x.id === item.id ? item : x)
      : [...menu, { ...item, id: 'item_' + Date.now() }];
    await saveMenu(m);
    await refreshMenu();
    setEditing(null);
  };

  const removeItem = async (id) => {
    if (confirm('Delete this item?')) {
      await saveMenu(menu.filter(m => m.id !== id));
      await refreshMenu();
    }
  };

  const saveCat = async (cat) => {
    const c = cat.id && categories.some(x => x.id === cat.id)
      ? categories.map(x => x.id === cat.id ? cat : x)
      : [...categories, { ...cat, id: 'cat_' + Date.now(), order: categories.length + 1 }];
    await saveCategories(c);
    await refreshMenu();
    setShowCatModal(false);
    setEditingCat(null);
  };

  const removeCat = async (id) => {
    if (confirm('Delete this category?')) {
      await saveCategories(categories.filter(c => c.id !== id));
      await refreshMenu();
    }
  };

  const reset = async () => {
    if (confirm('Reset menu to defaults? Custom items will be lost.')) {
      await resetMenuToDefaults();
      await refreshMenu();
    }
  };

  const toggleAvailable = async (item) => {
    const m = menu.map(x => x.id === item.id ? { ...x, available: !x.available } : x);
    await saveMenu(m);
    await refreshMenu();
  };

  return (
    <div>
      {/* CATEGORIES */}
      <div style={{ marginBottom: 24 }}>
        <div style={s.sectionHead}>
          <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>Categories ({categories.length})</div>
          <Button size="sm" onClick={() => { setEditingCat({}); setShowCatModal(true); }}>
            <Plus size={12} style={{ verticalAlign: 'middle' }} /> Add Category
          </Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categories.map(c => (
            <div key={c.id} style={s.catEditCard}>
              <span style={{ fontSize: 18 }}>{c.icon}</span>
              <span style={{ fontWeight: 800, fontSize: 13, color: C.text }}>{c.name}</span>
              <button onClick={() => { setEditingCat(c); setShowCatModal(true); }} style={s.iconBtn}><Edit3 size={12} /></button>
              <button onClick={() => removeCat(c.id)} style={s.iconBtn}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ITEMS */}
      <div style={s.sectionHead}>
        <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>Items ({menu.length})</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={reset}>Reset to defaults</Button>
          <Button size="sm" onClick={() => setEditing({})}>
            <Plus size={12} style={{ verticalAlign: 'middle' }} /> Add Item
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {menu.map(item => {
          const cat = categories.find(c => c.id === item.category);
          return (
            <div key={item.id} style={{
              ...s.itemCard,
              opacity: item.available ? 1 : 0.5,
            }}>
              <div style={{
                width: 50, height: 50,
                background: item.image ? `url(${item.image}) center/cover` : item.gradient,
                borderRadius: 8, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              }}>
                {!item.image && item.emoji}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>
                  {item.name}
                  {!item.available && <span style={{ marginLeft: 6, fontSize: 10, color: C.red, fontWeight: 900 }}>SOLD OUT</span>}
                </div>
                <div style={{ fontSize: 11, color: C.textMute, fontWeight: 700, marginTop: 2 }}>
                  {cat?.name || item.category} · {formatUSD(item.price)}
                </div>
              </div>
              <button onClick={() => toggleAvailable(item)} style={s.iconBtn} title={item.available ? 'Mark sold out' : 'Mark available'}>
                {item.available ? '✓' : '✕'}
              </button>
              <button onClick={() => setEditing(item)} style={s.iconBtn}><Edit3 size={14} /></button>
              <button onClick={() => removeItem(item.id)} style={s.iconBtn}><Trash2 size={14} /></button>
            </div>
          );
        })}
      </div>

      {editing !== null && (
        <ItemEditModal
          item={editing} categories={categories}
          onSave={saveItem} onClose={() => setEditing(null)}
        />
      )}
      {showCatModal && (
        <CategoryEditModal
          cat={editingCat || {}}
          onSave={saveCat}
          onClose={() => { setShowCatModal(false); setEditingCat(null); }}
        />
      )}
    </div>
  );
}

function ItemEditModal({ item, categories, onSave, onClose }) {
  const [form, setForm] = useState({
    name: item.name || '',
    price: item.price || 0,
    category: item.category || categories[0]?.id,
    image: item.image || '',
    emoji: item.emoji || '🧋',
    gradient: item.gradient || 'linear-gradient(135deg, #F4D9B0, #C9A87C)',
    popular: item.popular || false,
    available: item.available !== false,
    isAddon: item.isAddon || false,
  });

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave({
      ...item,
      ...form,
      price: parseFloat(form.price) || 0,
    });
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 18 }}>
          {item.id ? 'Edit Item' : 'New Item'}
        </div>

        <div style={{
          height: 100,
          background: form.image ? `url(${form.image}) center/cover` : form.gradient,
          borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 14,
        }}>
          {!form.image && <span style={{ fontSize: 50 }}>{form.emoji}</span>}
        </div>

        <Field label="Name">
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Brown Sugar Boba" autoFocus />
        </Field>
        <Field label="Price (USD)">
          <Input type="number" step="0.25" value={form.price}
            onChange={e => setForm({ ...form, price: e.target.value })} />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            }}>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </Field>
        <Field label="Image URL (optional)" hint="Paste any image URL. Leave empty to use emoji + gradient.">
          <Input value={form.image} onChange={e => setForm({ ...form, image: e.target.value })}
            placeholder="https://..." />
        </Field>
        <Field label="Emoji">
          <Input value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })} maxLength={2} />
        </Field>
        <Field label="Background gradient" hint="CSS gradient — used when no image">
          <Input value={form.gradient} onChange={e => setForm({ ...form, gradient: e.target.value })} />
        </Field>

        <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={form.popular}
              onChange={e => setForm({ ...form, popular: e.target.checked })} />
            ★ Popular (HOT badge)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={form.available}
              onChange={e => setForm({ ...form, available: e.target.checked })} />
            Available
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} style={{ flex: 1 }}>
            <Save size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CategoryEditModal({ cat, onSave, onClose }) {
  const [name, setName] = useState(cat.name || '');
  const [icon, setIcon] = useState(cat.icon || '🍴');

  return (
    <Modal onClose={onClose} maxWidth={400}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 18 }}>
          {cat.id ? 'Edit Category' : 'New Category'}
        </div>
        <Field label="Name">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Specials" autoFocus />
        </Field>
        <Field label="Icon (emoji)">
          <Input value={icon} onChange={e => setIcon(e.target.value)} maxLength={2} />
        </Field>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => name && onSave({ ...cat, name, icon })} style={{ flex: 1 }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// STAFF MANAGER
// ============================================================================
function StaffManager() {
  const [staff, setStaff] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const s = await loadStaff();
    setStaff(s);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (member) => {
    if (member.id && staff.some(s => s.id === member.id)) {
      await updateStaff(member.id, member);
    } else {
      await addStaff(member);
    }
    await load();
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this staff member?')) {
      try {
        await deleteStaff(id);
        await load();
      } catch (e) {
        alert(e.message);
      }
    }
  };

  return (
    <div>
      <div style={s.sectionHead}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>Staff ({staff.length})</div>
          <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginTop: 4 }}>
            Manager role required for: refunds, discounts, payment settings, Staff
          </div>
        </div>
        <Button size="sm" onClick={() => setEditing({})}>
          <Plus size={12} style={{ verticalAlign: 'middle' }} /> Add Staff
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {staff.map(m => (
          <div key={m.id} style={s.itemCard}>
            <Avatar staff={m} size={44} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>
                {m.name}
                {!m.active && <span style={{ marginLeft: 6, fontSize: 10, color: C.red, fontWeight: 900 }}>INACTIVE</span>}
              </div>
              <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginTop: 2, textTransform: 'capitalize' }}>
                {m.role} · PIN: ••••
              </div>
            </div>
            <button onClick={() => setEditing(m)} style={s.iconBtn}><Edit3 size={14} /></button>
            <button onClick={() => handleDelete(m.id)} style={s.iconBtn}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {editing !== null && (
        <StaffEditModal member={editing} onSave={handleSave} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function StaffEditModal({ member, onSave, onClose }) {
  const [form, setForm] = useState({
    name: member.name || '',
    role: member.role || 'cashier',
    pin: member.pin || '',
    active: member.active !== false,
    avatar: member.avatar || '',
  });

  const valid = form.name.trim() && /^\d{4}$/.test(form.pin);

  const onPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, avatar: reader.result }));
    reader.readAsDataURL(file);
  };

  return (
    <Modal onClose={onClose} maxWidth={400}>
      <div style={{ padding: 24 }}>
        <ModalClose onClose={onClose} />
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 18 }}>
          {member.id ? 'Edit Staff' : 'New Staff'}
        </div>

        <Field label="Profile picture" hint="Upload a photo, or type an emoji. Leave blank for auto initials.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar staff={{ ...form }} size={56} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <label style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '8px 12px', fontSize: 12, fontWeight: 800, color: C.text,
                cursor: 'pointer', textAlign: 'center',
              }}>
                Upload photo
                <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input value={/^(data:|https?:)/.test(form.avatar) ? '' : form.avatar}
                  onChange={e => setForm({ ...form, avatar: e.target.value })}
                  placeholder="😀 emoji" maxLength={3} style={{ flex: 1 }} />
                {form.avatar && (
                  <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, avatar: '' })}>Clear</Button>
                )}
              </div>
            </div>
          </div>
        </Field>

        <Field label="Name">
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Role">
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            }}>
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
          </select>
        </Field>
        <Field label="4-digit PIN" hint={!valid && form.pin ? 'Must be exactly 4 digits' : ''}>
          <Input value={form.pin}
            onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            maxLength={4} placeholder="0000" />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: C.text, marginTop: 10 }}>
          <input type="checkbox" checked={form.active}
            onChange={e => setForm({ ...form, active: e.target.checked })} />
          Active (can sign in)
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => valid && onSave({ ...member, ...form })}
            style={{ flex: 1, opacity: valid ? 1 : 0.4 }}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// SHOP INFO — Full editor (configurable per shop)
// ============================================================================
function ShopInfo() {
  const { shop, updateShop } = useShop();
  const [form, setForm] = useState({
    name:           shop.name || '',
    branch:         shop.branch || '',
    address:        shop.address || '',
    phone:          shop.phone || '',
    tax:            shop.tax != null ? (shop.tax * 100).toFixed(2) : '8.75',
    currency:       shop.currency || 'USD',
    currencySymbol: shop.currencySymbol || '$',
    sizeLargeBonus: shop.sizeLargeBonus != null ? shop.sizeLargeBonus : 0.75,
    tipPercents:    (shop.tipPercents || [15, 18, 20, 25]).join(', '),
    receiptFooter:  shop.receiptFooter || 'Thank you! Visit us again',
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // When shop changes externally (after save), sync form values
  useEffect(() => {
    setForm({
      name:           shop.name || '',
      branch:         shop.branch || '',
      address:        shop.address || '',
      phone:          shop.phone || '',
      tax:            shop.tax != null ? (shop.tax * 100).toFixed(2) : '8.75',
      currency:       shop.currency || 'USD',
      currencySymbol: shop.currencySymbol || '$',
      sizeLargeBonus: shop.sizeLargeBonus != null ? shop.sizeLargeBonus : 0.75,
      tipPercents:    (shop.tipPercents || [15, 18, 20, 25]).join(', '),
      receiptFooter:  shop.receiptFooter || 'Thank you! Visit us again',
    });
  }, [shop]);

  const valid = form.name.trim().length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      // Parse tip percents from comma-separated string
      const tips = form.tipPercents
        .split(',')
        .map(s => parseFloat(s.trim()))
        .filter(n => !isNaN(n) && n >= 0 && n <= 100);

      await updateShop({
        name:           form.name.trim(),
        branch:         form.branch.trim(),
        address:        form.address.trim(),
        phone:          form.phone.trim(),
        tax:            (parseFloat(form.tax) || 0) / 100,
        currency:       form.currency.trim().toUpperCase(),
        currencySymbol: form.currencySymbol.trim() || '$',
        sizeLargeBonus: parseFloat(form.sizeLargeBonus) || 0,
        tipPercents:    tips.length ? tips : [15, 18, 20, 25],
        receiptFooter:  form.receiptFooter.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{
        background: C.primaryA, border: `1px solid ${C.primary}33`,
        padding: 14, borderRadius: 12, marginBottom: 18,
        fontSize: 13, color: C.primary, fontWeight: 700,
      }}>
        💡 These settings apply to this shop only and are saved on this device.
        Set them up once when you install for a new customer.
      </div>

      <div style={{ background: C.panel, padding: 20, borderRadius: 14 }}>
        <SectionTitle>Shop Identity</SectionTitle>
        <Field label="Shop Name *" hint="Shown in top bar and receipts">
          <Input value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Boba Bliss" />
        </Field>
        <Field label="Branch / Location" hint="Optional subtitle (e.g., 'Downtown', 'Main Street')">
          <Input value={form.branch}
            onChange={e => setForm({ ...form, branch: e.target.value })}
            placeholder="e.g., Main Street" />
        </Field>
        <Field label="Address" hint="Printed on receipts">
          <Input value={form.address}
            onChange={e => setForm({ ...form, address: e.target.value })}
            placeholder="123 Main St, City, ST 12345" />
        </Field>
        <Field label="Phone Number">
          <Input value={form.phone}
            onChange={e => setForm({ ...form, phone: e.target.value })}
            placeholder="(555) 123-4567" />
        </Field>

        <SectionTitle>Pricing & Tax</SectionTitle>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="Tax Rate (%)" hint="Sales tax applied to subtotal">
              <Input type="number" step="0.01" min="0" max="50"
                value={form.tax}
                onChange={e => setForm({ ...form, tax: e.target.value })}
                placeholder="8.75" />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Large Size Upcharge" hint={`Added when customer picks "Large"`}>
              <Input type="number" step="0.25" min="0"
                value={form.sizeLargeBonus}
                onChange={e => setForm({ ...form, sizeLargeBonus: e.target.value })}
                placeholder="0.75" />
            </Field>
          </div>
        </div>

        <SectionTitle>Currency</SectionTitle>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="Code" hint="ISO code (display only)">
              <Input value={form.currency} maxLength={3}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                placeholder="USD" />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Symbol" hint="Shown before prices">
              <Input value={form.currencySymbol} maxLength={3}
                onChange={e => setForm({ ...form, currencySymbol: e.target.value })}
                placeholder="$" />
            </Field>
          </div>
        </div>

        <SectionTitle>Receipts</SectionTitle>
        <Field label="Suggested Tips (%)" hint="Comma-separated, shown on card terminal">
          <Input value={form.tipPercents}
            onChange={e => setForm({ ...form, tipPercents: e.target.value })}
            placeholder="15, 18, 20, 25" />
        </Field>
        <Field label="Receipt Footer Message">
          <Input value={form.receiptFooter}
            onChange={e => setForm({ ...form, receiptFooter: e.target.value })}
            placeholder="Thank you! Visit us again" />
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button
            onClick={handleSave}
            disabled={!valid || saving}
            style={{ flex: 1, opacity: (valid && !saving) ? 1 : 0.5 }}>
            {saving ? 'Saving...' : saved ? <><Check size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Saved</> : <><Save size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Save Shop Info</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color: C.textMute,
      textTransform: 'uppercase', letterSpacing: 1,
      marginTop: 20, marginBottom: 10,
      paddingBottom: 6, borderBottom: `1px solid ${C.border}`,
    }}>{children}</div>
  );
}

// ============================================================================
// DEVICE MODE — flip this tablet between POS terminal and customer Kiosk
// ============================================================================
function DeviceModeSettings({ mode, changeMode }) {
  const [confirmKiosk, setConfirmKiosk] = useState(false);
  const isKiosk = mode === 'kiosk';

  const card = (active) => ({
    flex: 1, padding: 18, borderRadius: 14, textAlign: 'left',
    border: `2px solid ${active ? C.primary : C.border}`,
    background: active ? C.primaryA : C.panel,
    color: C.text,
  });

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>Device Mode</div>
      <div style={{ fontSize: 13, color: C.textMute, fontWeight: 700, marginBottom: 18, lineHeight: 1.5 }}>
        Choose how this specific tablet runs. The same app can be a full
        <b> POS</b> terminal or a customer-facing <b>Kiosk</b>. This setting is
        saved on this device only.
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
        <div style={card(!isKiosk)}>
          <Store size={22} color={!isKiosk ? C.primary : C.textMute} />
          <div style={{ fontSize: 16, fontWeight: 900, marginTop: 8 }}>POS terminal</div>
          <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginTop: 4 }}>
            Cashier sign-in, order entry, payments, reports, settings.
          </div>
          {!isKiosk && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: C.primary }}>● Current mode</div>}
        </div>
        <div style={card(isKiosk)}>
          <Monitor size={22} color={isKiosk ? C.primary : C.textMute} />
          <div style={{ fontSize: 16, fontWeight: 900, marginTop: 8 }}>Kiosk</div>
          <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginTop: 4 }}>
            Full-screen customer self-order. No staff sign-in.
          </div>
          {isKiosk && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: C.primary }}>● Current mode</div>}
        </div>
      </div>

      {!isKiosk && !confirmKiosk && (
        <Button onClick={() => setConfirmKiosk(true)} style={{ width: '100%' }}>
          <Monitor size={16} /> Switch this device to Kiosk mode
        </Button>
      )}

      {!isKiosk && confirmKiosk && (
        <div style={{ background: C.panel, padding: 18, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Switch to Kiosk mode?</div>
          <div style={{ fontSize: 12, color: C.textMute, fontWeight: 700, marginBottom: 14, lineHeight: 1.5 }}>
            The screen will lock into the customer self-order view. To get back to
            POS, tap the <b>top-left corner 5 times</b>, enter the Manager PIN,
            then choose <b>Switch to POS mode</b>.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setConfirmKiosk(false)} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onClick={() => changeMode('kiosk')} style={{ flex: 1 }}>
              <Monitor size={16} /> Switch to Kiosk
            </Button>
          </div>
        </div>
      )}

      {isKiosk && (
        <Button onClick={() => changeMode('pos')} variant="ghost" style={{ width: '100%' }}>
          <Store size={16} /> Switch this device back to POS
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// ABOUT
// ============================================================================
function AboutTab() {
  const [tapCount, setTapCount] = useState(0);
  const [debug, setDebug] = useState(false);

  const isDev = BUILD_DATE === '__BUILD_DATE__';
  const buildDate = isDev ? 'Development build' : new Date(BUILD_DATE).toLocaleString();
  const buildNum = BUILD_NUMBER === '__BUILD_NUMBER__' ? 'local' : `#${BUILD_NUMBER}`;
  const commit = COMMIT_SHORT === '__COMMIT_SHORT__' ? 'local' : COMMIT_SHORT;

  const copy = () => {
    const text = `Vido Food Debug
Version: ${APP_VERSION}
Build: ${buildNum}
Built: ${buildDate}
Commit: ${commit}
UA: ${navigator.userAgent}
Screen: ${window.screen.width}x${window.screen.height}
Online: ${navigator.onLine}`;
    navigator.clipboard?.writeText(text);
    alert('Copied to clipboard');
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{
        background: C.primaryG,
        padding: 24, borderRadius: 14,
        textAlign: 'center', color: '#fff',
        marginBottom: 14,
        boxShadow: C.primaryGShadow,
      }}>
        <div style={{
          width: 84, height: 84, borderRadius: 22, margin: '0 auto 10px',
          background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
        }}>
          <BrandMark size={64} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 900 }}>Vido Food</div>
        <div
          onClick={() => { const n = tapCount + 1; setTapCount(n); if (n >= 7) setDebug(true); }}
          style={{ fontSize: 14, opacity: 0.92, fontWeight: 800, marginTop: 4, cursor: 'pointer', userSelect: 'none' }}>
          Version {APP_VERSION} · Build {buildNum}
        </div>
      </div>

      <div style={{ background: C.panel, padding: 18, borderRadius: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.textMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Build Information
        </div>
        <InfoRow label="Version" value={APP_VERSION} mono />
        <InfoRow label="Build" value={buildNum} mono />
        <InfoRow label="Built On" value={buildDate} />
        <InfoRow label="Commit" value={commit} mono />
        <InfoRow label="Environment" value={isDev ? '🔧 Development' : '🚀 Production'} />
      </div>

      <Button onClick={copy} variant="ghost" style={{ width: '100%' }}>
        📋 Copy Debug Info
      </Button>

      {debug && (
        <div style={{
          background: C.panel, padding: 18, borderRadius: 12,
          border: `2px solid ${C.yellow}`, marginTop: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.yellow, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            🔓 Developer Info
          </div>
          <InfoRow label="Screen" value={`${window.screen.width}×${window.screen.height}`} mono />
          <InfoRow label="Viewport" value={`${window.innerWidth}×${window.innerHeight}`} mono />
          <InfoRow label="Pixel Ratio" value={`${window.devicePixelRatio}x`} mono />
          <InfoRow label="Online" value={navigator.onLine ? '✓ Yes' : '✗ No'} />
          <InfoRow label="Language" value={navigator.language} mono />
        </div>
      )}

      <div style={{ fontSize: 11, color: C.textDim, fontWeight: 700, textAlign: 'center', marginTop: 16 }}>
        Built for Vido Booking · {new Date().getFullYear()}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', padding: '6px 0',
      borderBottom: `1px dashed ${C.border}`,
    }}>
      <span style={{ fontSize: 12, color: C.textMute, fontWeight: 700 }}>{label}</span>
      <span style={{
        fontSize: 12, color: C.text, fontWeight: 800,
        fontFamily: mono ? 'ui-monospace, "SF Mono", Menlo, monospace' : 'inherit',
        textAlign: 'right',
      }}>{value}</span>
    </div>
  );
}

// ============================================================================
const s = {
  container: { padding: 24, color: C.text, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  title: { fontSize: 22, fontWeight: 900, marginBottom: 18, color: C.text },
  tabs: {
    display: 'flex', gap: 4, background: C.panel,
    padding: 4, borderRadius: 12, marginBottom: 18,
    flexWrap: 'wrap',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  tabContent: { flex: 1, overflowY: 'auto' },
  checkLine: { display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 13, fontWeight: 800 },
  select: {
    width: '100%',
    minHeight: 38,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    padding: '8px 10px',
    fontSize: 14,
    fontWeight: 800,
    outline: 'none',
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 },
  catEditCard: {
    background: C.card, padding: '8px 12px',
    borderRadius: 10, display: 'flex',
    alignItems: 'center', gap: 8,
  },
  itemCard: {
    background: C.panel, padding: 10,
    borderRadius: 12, display: 'flex',
    alignItems: 'center', gap: 10,
  },
  iconBtn: {
    width: 28, height: 28,
    background: C.card, color: C.textMute,
    border: 'none', borderRadius: 6, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
};

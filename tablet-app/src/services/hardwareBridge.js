/**
 * hardwareBridge.js — POS hardware helpers.
 *
 * Native Android calls CashDrawerPlugin. Web preview simulates the action so the
 * POS UI can still be tested from Vite.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getJSON, setJSON } from './storage';

const CONFIG_KEY = 'vido_hardware_config';

export const DEFAULT_HARDWARE_CONFIG = {
  cashDrawerMode: 'android_intent', // android_intent | network_escpos | usb_escpos
  printerHost: '',
  printerPort: 9100,
  usbVendorId: 0,
  usbProductId: 0,
  pulsePin: 0,
  pulseOnMs: 25,
  pulseOffMs: 250,
  customIntentAction: '',
};

let CashDrawer = null;
function getCashDrawerPlugin() {
  if (!CashDrawer && Capacitor.isNativePlatform()) {
    CashDrawer = registerPlugin('CashDrawer');
  }
  return CashDrawer;
}

class HardwareService {
  constructor() {
    this.config = { ...DEFAULT_HARDWARE_CONFIG };
    this.isNative = Capacitor.isNativePlatform();
    this.ready = this._loadConfig();
  }

  async _loadConfig() {
    const saved = await getJSON(CONFIG_KEY, null);
    if (saved) this.config = { ...DEFAULT_HARDWARE_CONFIG, ...saved };
    return this.config;
  }

  async updateConfig(cfg) {
    await this.ready;
    this.config = { ...this.config, ...cfg };
    await setJSON(CONFIG_KEY, this.config);
    return this.config;
  }

  async openCashDrawer(overrides = {}) {
    await this.ready;
    const cfg = { ...this.config, ...overrides };

    if (!this.isNative) {
      await new Promise(r => setTimeout(r, 300));
      return { ok: true, simulated: true, message: 'Cash drawer opened in web preview' };
    }

    const plugin = getCashDrawerPlugin();
    if (!plugin) throw new Error('CashDrawer plugin is not available on this device');

    return plugin.openCashDrawer({
      mode: cfg.cashDrawerMode,
      printerHost: cfg.printerHost,
      printerPort: Number(cfg.printerPort) || 9100,
      usbVendorId: Number(cfg.usbVendorId) || 0,
      usbProductId: Number(cfg.usbProductId) || 0,
      pulsePin: Number(cfg.pulsePin) || 0,
      pulseOnMs: Number(cfg.pulseOnMs) || 25,
      pulseOffMs: Number(cfg.pulseOffMs) || 250,
      customIntentAction: cfg.customIntentAction || '',
    });
  }

  async getDeviceInfo() {
    if (!this.isNative) {
      return {
        manufacturer: 'Web Preview',
        brand: navigator.userAgent,
        model: 'Browser',
        device: 'web',
        product: 'vite',
        androidRelease: '-',
      };
    }

    const plugin = getCashDrawerPlugin();
    if (!plugin?.getDeviceInfo) throw new Error('Device info is not available');
    return plugin.getDeviceInfo();
  }

  async listUsbDevices() {
    if (!this.isNative) {
      return { devices: [] };
    }

    const plugin = getCashDrawerPlugin();
    if (!plugin?.listUsbDevices) throw new Error('USB scan is not available');
    return plugin.listUsbDevices();
  }

  async printUsbEscpos(bytes) {
    await this.ready;
    if (!this.isNative) {
      await new Promise(r => setTimeout(r, 300));
      return { ok: true, simulated: true, sent: bytes?.length || 0 };
    }

    const plugin = getCashDrawerPlugin();
    if (!plugin?.writeUsbEscpos) throw new Error('USB receipt printing is not available');
    return plugin.writeUsbEscpos({
      data: bytesToBase64(bytes),
      usbVendorId: Number(this.config.usbVendorId) || 0,
      usbProductId: Number(this.config.usbProductId) || 0,
    });
  }
}

export const hardwareService = new HardwareService();

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

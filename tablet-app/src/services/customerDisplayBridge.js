import { Capacitor, registerPlugin } from '@capacitor/core';
import { getJSON, setJSON } from './storage';
import { SHOP } from '../config';

const CONFIG_KEY = 'vido_customer_display_config';

const DEFAULT_CONFIG = {
  enabled: false,
  autoManage: true,
  displayId: null,
  mode: 'customer',
};

let CustomerDisplay = null;
function getPlugin() {
  if (!CustomerDisplay && Capacitor.isNativePlatform()) {
    CustomerDisplay = registerPlugin('CustomerDisplay');
  }
  return CustomerDisplay;
}

class CustomerDisplayService {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.displays = [];
    this.ready = this._loadConfig();
    this.isNative = Capacitor.isNativePlatform();
  }

  async _loadConfig() {
    const saved = await getJSON(CONFIG_KEY, null);
    if (saved) this.config = { ...DEFAULT_CONFIG, ...saved };
  }

  async updateConfig(updates) {
    await this.ready;
    this.config = { ...this.config, ...updates };
    await setJSON(CONFIG_KEY, this.config);
    return this.config;
  }

  async listDisplays() {
    await this.ready;
    if (!this.isNative) {
      this.displays = [
        { id: 0, name: 'Main POS Screen', isPrimary: true, width: window.innerWidth, height: window.innerHeight },
        { id: 1, name: 'Customer Display (web preview)', isPrimary: false, isPresentation: true, width: 1024, height: 600 },
      ];
      return this.displays;
    }
    const plugin = getPlugin();
    const res = await plugin.listDisplays();
    this.displays = res.displays || [];
    return this.displays;
  }

  async autoConfigure() {
    await this.ready;
    const displays = await this.listDisplays();
    const secondary = displays.find(d => !d.isPrimary);

    if (!this.isNative) {
      return { ...this.config, displays, hasSecondary: true, web: true };
    }

    if (!secondary) {
      await this.hide();
      await this.updateConfig({ enabled: false, displayId: null });
      return { ...this.config, displays, hasSecondary: false };
    }

    if (this.config.autoManage) {
      await this.updateConfig({ enabled: true, displayId: this.config.displayId ?? secondary.id });
      await this.show();
    }
    return { ...this.config, displays, hasSecondary: true };
  }

  async show(displayId = this.config.displayId) {
    await this.ready;
    if (!this.isNative) return { ok: true, web: true };
    const plugin = getPlugin();
    const res = await plugin.show({ displayId });
    await this.updateConfig({ enabled: true, displayId: res.displayId ?? displayId ?? this.config.displayId });
    return res;
  }

  async hide() {
    await this.ready;
    if (!this.isNative) return { ok: true, web: true };
    const plugin = getPlugin();
    return plugin.hide();
  }

  async setEnabled(enabled) {
    await this.ready;
    if (enabled) {
      const displays = await this.listDisplays();
      const secondary = displays.find(d => !d.isPrimary);
      if (this.isNative && !secondary) {
        await this.updateConfig({ enabled: false, displayId: null });
        return { ok: false, error: 'No customer display detected' };
      }
      if (!this.config.displayId && secondary) await this.updateConfig({ displayId: secondary.id });
      const res = await this.show(this.config.displayId);
      await this.updateConfig({ enabled: true });
      return res;
    }
    await this.hide();
    await this.updateConfig({ enabled: false });
    return { ok: true };
  }

  async update(payload) {
    await this.ready;
    if (!this.config.enabled) return { ok: false, skipped: true };
    if (!this.isNative) return { ok: true, web: true };
    const plugin = getPlugin();
    return plugin.update({ json: JSON.stringify(payload) });
  }

  orderPayload(order, totals, shop) {
    if (!order || !order.items?.length) {
      return { state: 'idle', shop: { name: shop?.name || 'My Shop', currencySymbol: '$' } };
    }
    return {
      state: 'order',
      shop: { name: shop?.name || 'My Shop', currencySymbol: '$' },
      orderNumber: order.number,
      items: order.items.map(line => {
        const qty = line.qty || 1;
        const toppings = (line.toppings || []).reduce((sum, t) => sum + (t.price || 0), 0);
        const large = line.size === 'L' ? (shop?.sizeLargeBonus ?? SHOP.sizeLargeBonus ?? 0) : 0;
        const total = ((line.basePrice || 0) + toppings + large) * qty;
        return {
          name: line.name,
          emoji: line.emoji,
          details: [line.size && line.size !== 'R' ? 'Large' : '', line.sugar !== 100 ? `${line.sugar}% sugar` : '', line.ice !== 100 ? `${line.ice}% ice` : '', line.toppings?.length ? `+ ${line.toppings.map(t => t.name).join(', ')}` : ''].filter(Boolean).join(' · '),
          qty,
          total: Math.round(total * 100) / 100,
        };
      }),
      subtotal: totals.sub,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
    };
  }

  paymentPayload(order, totals, method, shop) {
    return {
      state: 'payment',
      shop: { name: shop?.name || 'My Shop', currencySymbol: '$' },
      orderNumber: order?.number,
      total: totals.total,
      method,
    };
  }

  donePayload(totals, shop) {
    return {
      state: 'done',
      shop: { name: shop?.name || 'My Shop', currencySymbol: '$' },
      total: totals.total,
    };
  }
}

export const customerDisplayService = new CustomerDisplayService();

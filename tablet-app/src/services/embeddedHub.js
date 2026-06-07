/**
 * embeddedHub.js — JS bridge to the native EmbeddedHub plugin (POS only).
 *
 * On a POS Android tablet this starts an in-app HTTP server so the tablet
 * itself becomes the "switchboard" kiosks send orders to — no separate
 * computer needed. On web (preview) it is a no-op so the UI still renders.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

let Hub = null;
function plugin() {
  if (!Hub && Capacitor.isNativePlatform()) {
    Hub = registerPlugin('EmbeddedHub');
  }
  return Hub;
}

export const HUB_PORT = 8787;
export const LOCAL_HUB_URL = `http://127.0.0.1:${HUB_PORT}`;

export const embeddedHub = {
  isSupported() {
    return Capacitor.isNativePlatform();
  },

  /** Start the in-app hub. Returns { running, port, ip }. */
  async start() {
    const p = plugin();
    if (!p) {
      // Web preview: pretend it's up so the POS UI behaves normally.
      return { running: false, supported: false, port: HUB_PORT, ip: '' };
    }
    try {
      const res = await p.start({ port: HUB_PORT });
      return { supported: true, ...res };
    } catch (e) {
      return { running: false, supported: true, port: HUB_PORT, ip: '', error: e?.message || String(e) };
    }
  },

  async stop() {
    const p = plugin();
    if (!p) return { running: false };
    try { return await p.stop(); } catch { return { running: false }; }
  },

  async status() {
    const p = plugin();
    if (!p) return { running: false, supported: false, port: HUB_PORT, ip: '' };
    try { return { supported: true, ...(await p.status()) }; }
    catch (e) { return { running: false, supported: true, port: HUB_PORT, ip: '', error: e?.message }; }
  },

  /** The address kiosks should connect to, e.g. http://192.168.1.50:8787 */
  async lanUrl() {
    const p = plugin();
    if (!p) return '';
    try {
      const { ip } = await p.getLanIp();
      return ip ? `http://${ip}:${HUB_PORT}` : '';
    } catch { return ''; }
  },

  async lanIp() {
    const p = plugin();
    if (!p) return '';
    try { return (await p.getLanIp())?.ip || ''; } catch { return ''; }
  },
};

/**
 * storage.js — unified storage layer.
 * Uses Capacitor Preferences on native Android, localStorage on web preview.
 */

import { Capacitor } from '@capacitor/core';

let _backend = null;

async function getBackend() {
  if (_backend) return _backend;
  if (Capacitor.isNativePlatform()) {
    const { Preferences } = await import('@capacitor/preferences');
    _backend = {
      get: async (k) => (await Preferences.get({ key: k })).value,
      set: async (k, v) => Preferences.set({ key: k, value: v }),
      remove: async (k) => Preferences.remove({ key: k }),
    };
  } else {
    _backend = {
      get: async (k) => localStorage.getItem(k),
      set: async (k, v) => localStorage.setItem(k, v),
      remove: async (k) => localStorage.removeItem(k),
    };
  }
  return _backend;
}

export async function getJSON(key, fallback = null) {
  try {
    const b = await getBackend();
    const v = await b.get(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export async function setJSON(key, value) {
  const b = await getBackend();
  await b.set(key, JSON.stringify(value));
}

export async function remove(key) {
  const b = await getBackend();
  await b.remove(key);
}

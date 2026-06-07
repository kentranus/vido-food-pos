/**
 * fcmService.js — Firebase Cloud Messaging registration for the POS device.
 *
 * Registers the device with FCM, gets a token, and hands it to the caller to
 * send to the backend (which pushes "new order" alerts even when the app is
 * closed / screen locked). Web preview is a no-op (native only).
 *
 * A HIGH-importance notification channel ("orders") is created so the alert
 * shows as a heads-up with sound even in the background. (Continuous looping
 * ring via full-screen intent is a later enhancement.)
 */

import { Capacitor } from '@capacitor/core';

let _started = false;

export async function registerPush({ onToken, onForeground } = {}) {
  if (_started) return;
  if (!Capacitor.isNativePlatform()) return; // browser preview — skip
  _started = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') { _started = false; return; }

    // High-importance channel with the custom "new order" bell. NOTE: a channel's
    // sound is locked once created, so we use a fresh id ('orders_v2') to switch
    // away from the old default-sound channel. sound = raw resource name (order_alert.wav).
    try {
      await PushNotifications.createChannel({
        id: 'orders_v2', name: 'New orders', description: 'Incoming online orders',
        importance: 5, visibility: 1, vibration: true, sound: 'order_alert',
      });
    } catch { /* channel may already exist */ }

    PushNotifications.addListener('registration', (t) => { onToken && onToken(t.value); });
    PushNotifications.addListener('registrationError', (e) => console.warn('[fcm] registration error', e));
    // App in foreground when a push arrives → let the caller refresh / chime.
    PushNotifications.addListener('pushNotificationReceived', (n) => { onForeground && onForeground(n); });

    await PushNotifications.register();
  } catch (e) {
    _started = false;
    console.warn('[fcm] register failed', e);
  }
}

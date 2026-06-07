/**
 * hubIngest.js — POS-side ingestion of kiosk/online orders from the POS Hub.
 *
 * Shared by:
 *   - App.jsx background poller (auto, runs whenever the POS app is open)
 *   - OperationsView "Refresh" button (manual)
 *
 * Pulls orders with status 'paid', saves any new ones locally (de-duped by
 * hubId), prints the kitchen ticket, then marks them 'accepted' on the hub so
 * they are not pulled again.
 */
import { loadAllOrders, saveOrder } from './orderStorage';
import { orderHubService } from './orderHubService';
import { printKitchenTicket } from '../views/OrderView';

let _running = false;

/**
 * @returns {{enabled:boolean, online:boolean, imported:number, message:string}}
 */
export async function ingestHubOrders(staffName = 'POS') {
  await orderHubService.ready;
  if (!orderHubService.config.enabled) {
    return { enabled: false, online: false, imported: 0, message: 'Order Hub is off' };
  }
  // Prevent overlapping runs (poller + manual refresh at the same time).
  if (_running) {
    return { enabled: true, online: true, imported: 0, message: 'Sync already in progress' };
  }
  _running = true;
  try {
    const res = await orderHubService.fetchOrders({ status: 'paid' });
    const localOrders = await loadAllOrders();
    const seen = new Set(localOrders.map(o => o.hubId || o.id));
    let imported = 0;

    for (const order of res.orders || []) {
      const key = order.hubId || order.id;
      if (!seen.has(key)) {
        const stored = {
          ...order,
          id: order.id || order.hubId,
          status: 'complete',
          source: order.source || 'kiosk',
          completedAt: order.completedAt || new Date().toISOString(),
        };
        await saveOrder(stored);
        seen.add(key); // update within the loop so a duplicate in the same batch is skipped
        imported += 1;
        if (orderHubService.config.autoPrintKitchenTickets) {
          await printKitchenTicket(stored).catch(e => console.warn('Hub ticket print failed:', e));
        }
      }
      if (orderHubService.config.autoAcceptKioskOrders) {
        await orderHubService.updateOrderStatus(key, 'accepted', {
          acceptedAt: new Date().toISOString(),
          acceptedBy: staffName || 'POS',
        }).catch(e => console.warn('Hub accept failed:', e));
      }
    }
    return {
      enabled: true,
      online: true,
      imported,
      message: imported ? `${imported} new kiosk/online order(s)` : 'Up to date',
    };
  } catch (e) {
    return { enabled: true, online: false, imported: 0, message: e.message || 'Order Hub offline' };
  } finally {
    _running = false;
  }
}

/**
 * Background poller for the POS app. Call once at startup (POS mode only).
 * Returns a stop function.
 */
export function startHubPolling({ intervalMs = 6000, staffName = 'POS', onResult } = {}) {
  let timer = null;
  const tick = async () => {
    const result = await ingestHubOrders(staffName);
    if (onResult) { try { onResult(result); } catch {} }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  return () => { if (timer) clearInterval(timer); timer = null; };
}

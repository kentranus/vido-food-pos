import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'hub-state.json');
const PORT = Number(process.env.PORT || 8787);

async function loadState() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'));
  } catch {
    return { stores: {} };
  }
}

async function saveState(state) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(state, null, 2));
}

function storeState(state, storeId) {
  if (!state.stores[storeId]) {
    state.stores[storeId] = { nextOrderNumber: 1000, orders: [] };
  }
  return state.stores[storeId];
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function publicOrder(order) {
  return {
    ...order,
    hubReceivedAt: order.hubReceivedAt,
    hubUpdatedAt: order.hubUpdatedAt,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'vido-food-pos-hub', time: new Date().toISOString() });
    }

    const matchOrders = url.pathname.match(/^\/api\/stores\/([^/]+)\/orders\/?([^/]*)$/);
    if (!matchOrders) return send(res, 404, { ok: false, error: 'Not found' });

    const storeId = decodeURIComponent(matchOrders[1]);
    const orderId = matchOrders[2] ? decodeURIComponent(matchOrders[2]) : '';
    const state = await loadState();
    const store = storeState(state, storeId);

    if (req.method === 'GET' && !orderId) {
      const status = url.searchParams.get('status');
      const since = url.searchParams.get('since');
      const sinceMs = since ? new Date(since).getTime() : 0;
      let orders = store.orders;
      if (status) {
        const wanted = status.split(',').map(s => s.trim()).filter(Boolean);
        orders = orders.filter(o => wanted.includes(o.status));
      }
      if (sinceMs) {
        orders = orders.filter(o => new Date(o.hubUpdatedAt || o.hubReceivedAt || o.completedAt || o.createdAt).getTime() > sinceMs);
      }
      return send(res, 200, { ok: true, orders: orders.map(publicOrder), nextOrderNumber: store.nextOrderNumber });
    }

    if (req.method === 'POST' && !orderId) {
      const body = await readBody(req);
      const incoming = body.order || {};
      const now = new Date().toISOString();
      const assignedNumber = store.nextOrderNumber++;
      const id = incoming.id || `H${Date.now()}`;
      const order = {
        ...incoming,
        id,
        hubId: id,
        number: assignedNumber,
        source: body.source || incoming.source || 'kiosk',
        stationId: body.stationId || incoming.stationId || '',
        status: incoming.status || 'paid',
        hubReceivedAt: now,
        hubUpdatedAt: now,
      };
      store.orders.push(order);
      await saveState(state);
      return send(res, 201, { ok: true, order: publicOrder(order), nextOrderNumber: store.nextOrderNumber });
    }

    if (req.method === 'PATCH' && orderId) {
      const body = await readBody(req);
      const idx = store.orders.findIndex(o => o.id === orderId || o.hubId === orderId);
      if (idx < 0) return send(res, 404, { ok: false, error: 'Order not found' });
      store.orders[idx] = {
        ...store.orders[idx],
        ...body,
        hubUpdatedAt: new Date().toISOString(),
      };
      await saveState(state);
      return send(res, 200, { ok: true, order: publicOrder(store.orders[idx]) });
    }

    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    send(res, 500, { ok: false, error: e.message || 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Vido Food POS Hub running on http://0.0.0.0:${PORT}`);
});

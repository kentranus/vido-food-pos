package com.vido.food;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * EmbeddedHubPlugin — runs the Vido Food POS Hub INSIDE the POS Android app.
 *
 * This removes the need for a separate computer: the POS tablet itself becomes
 * the "switchboard" that kiosks send orders to. It serves the exact same HTTP
 * API as pos-hub/server.js:
 *
 *   GET    /health
 *   GET    /api/stores/{storeId}/orders?status=paid
 *   POST   /api/stores/{storeId}/orders        (assigns a shared order number)
 *   PATCH  /api/stores/{storeId}/orders/{id}   (update status, e.g. accepted)
 *
 * State is persisted to a JSON file in the app's private storage, so orders
 * survive an app restart. Implemented with a plain ServerSocket (no external
 * dependency) to match the project's existing native-socket style and to keep
 * the CI build simple.
 */
@CapacitorPlugin(name = "EmbeddedHub")
public class EmbeddedHubPlugin extends Plugin {

    private static final int DEFAULT_PORT = 8787;

    private ServerSocket serverSocket;
    private Thread acceptThread;
    private ExecutorService workers;
    private volatile boolean running = false;
    private int port = DEFAULT_PORT;

    private final Object stateLock = new Object();
    private JSONObject state; // { stores: { storeId: { nextOrderNumber, orders: [] } } }

    // ---------------------------------------------------------------- lifecycle

    @PluginMethod
    public void start(PluginCall call) {
        int requestedPort = call.getInt("port", DEFAULT_PORT);
        synchronized (this) {
            if (running) {
                JSObject ret = new JSObject();
                ret.put("running", true);
                ret.put("port", port);
                ret.put("ip", lanIp());
                call.resolve(ret);
                return;
            }
            try {
                loadState();
                port = requestedPort;
                serverSocket = new ServerSocket();
                serverSocket.setReuseAddress(true);
                serverSocket.bind(new java.net.InetSocketAddress("0.0.0.0", port));
                workers = Executors.newCachedThreadPool();
                running = true;
                acceptThread = new Thread(this::acceptLoop, "vido-hub-accept");
                acceptThread.setDaemon(true);
                acceptThread.start();

                JSObject ret = new JSObject();
                ret.put("running", true);
                ret.put("port", port);
                ret.put("ip", lanIp());
                call.resolve(ret);
            } catch (Exception e) {
                running = false;
                call.reject("Could not start embedded hub: " + e.getMessage());
            }
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synchronized (this) {
            running = false;
            try { if (serverSocket != null) serverSocket.close(); } catch (Exception ignored) {}
            if (workers != null) workers.shutdownNow();
            serverSocket = null;
        }
        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", running);
        ret.put("port", port);
        ret.put("ip", lanIp());
        call.resolve(ret);
    }

    @PluginMethod
    public void getLanIp(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ip", lanIp());
        ret.put("port", port);
        call.resolve(ret);
    }

    // ------------------------------------------------------------- server loop

    private void acceptLoop() {
        while (running) {
            try {
                final Socket client = serverSocket.accept();
                workers.submit(() -> handle(client));
            } catch (Exception e) {
                if (running) {
                    // transient accept error; brief pause then continue
                    try { Thread.sleep(50); } catch (InterruptedException ignored) {}
                }
            }
        }
    }

    private void handle(Socket client) {
        try {
            client.setSoTimeout(15000);
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) { client.close(); return; }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { client.close(); return; }
            String method = parts[0].toUpperCase();
            String target = parts[1];

            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    String key = line.substring(0, colon).trim().toLowerCase();
                    String val = line.substring(colon + 1).trim();
                    if (key.equals("content-length")) {
                        try { contentLength = Integer.parseInt(val); } catch (NumberFormatException ignored) {}
                    }
                }
            }

            String body = "";
            if (contentLength > 0) {
                byte[] buf = new byte[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int r = in.read(buf, read, contentLength - read);
                    if (r < 0) break;
                    read += r;
                }
                body = new String(buf, 0, read, StandardCharsets.UTF_8);
            }

            route(out, method, target, body);
            out.flush();
            client.close();
        } catch (Exception e) {
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    // ----------------------------------------------------------------- routing

    private void route(OutputStream out, String method, String target, String body) throws Exception {
        if (method.equals("OPTIONS")) { respond(out, 204, "{}"); return; }

        String path = target;
        String query = "";
        int q = target.indexOf('?');
        if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }

        if (path.equals("/health")) {
            JSONObject ok = new JSONObject();
            ok.put("ok", true);
            ok.put("service", "vido-food-pos-hub");
            ok.put("embedded", true);
            ok.put("time", nowIso());
            respond(out, 200, ok.toString());
            return;
        }

        // /api/stores/{storeId}/orders[/{orderId}]
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^/api/stores/([^/]+)/orders/?([^/]*)$").matcher(path);
        if (!m.matches()) { respond(out, 404, err("Not found")); return; }

        String storeId = urlDecode(m.group(1));
        String orderId = m.group(2) != null && !m.group(2).isEmpty() ? urlDecode(m.group(2)) : "";

        synchronized (stateLock) {
            JSONObject store = storeState(storeId);
            JSONArray orders = store.getJSONArray("orders");

            if (method.equals("GET") && orderId.isEmpty()) {
                String status = queryParam(query, "status");
                JSONArray result = new JSONArray();
                for (int i = 0; i < orders.length(); i++) {
                    JSONObject o = orders.getJSONObject(i);
                    if (status == null || statusMatches(o.optString("status", ""), status)) {
                        result.put(o);
                    }
                }
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("orders", result);
                res.put("nextOrderNumber", store.optInt("nextOrderNumber", 1000));
                respond(out, 200, res.toString());
                return;
            }

            if (method.equals("POST") && orderId.isEmpty()) {
                JSONObject parsed = body.isEmpty() ? new JSONObject() : new JSONObject(body);
                JSONObject incoming = parsed.optJSONObject("order");
                if (incoming == null) incoming = new JSONObject();
                String now = nowIso();
                int assigned = store.optInt("nextOrderNumber", 1000);
                store.put("nextOrderNumber", assigned + 1);
                String id = incoming.optString("id", "");
                if (id.isEmpty()) id = "H" + System.currentTimeMillis();

                incoming.put("id", id);
                incoming.put("hubId", id);
                incoming.put("number", assigned);
                incoming.put("source", parsed.optString("source", incoming.optString("source", "kiosk")));
                incoming.put("stationId", parsed.optString("stationId", incoming.optString("stationId", "")));
                if (incoming.optString("status", "").isEmpty()) incoming.put("status", "paid");
                incoming.put("hubReceivedAt", now);
                incoming.put("hubUpdatedAt", now);

                orders.put(incoming);
                trim(orders, 500);
                saveState();

                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("order", incoming);
                res.put("nextOrderNumber", store.optInt("nextOrderNumber", 1000));
                respond(out, 201, res.toString());
                return;
            }

            if (method.equals("PATCH") && !orderId.isEmpty()) {
                JSONObject patch = body.isEmpty() ? new JSONObject() : new JSONObject(body);
                int idx = -1;
                for (int i = 0; i < orders.length(); i++) {
                    JSONObject o = orders.getJSONObject(i);
                    if (orderId.equals(o.optString("id")) || orderId.equals(o.optString("hubId"))) { idx = i; break; }
                }
                if (idx < 0) { respond(out, 404, err("Order not found")); return; }
                JSONObject o = orders.getJSONObject(idx);
                java.util.Iterator<String> it = patch.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    o.put(k, patch.get(k));
                }
                o.put("hubUpdatedAt", nowIso());
                orders.put(idx, o);
                saveState();

                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("order", o);
                respond(out, 200, res.toString());
                return;
            }

            respond(out, 405, err("Method not allowed"));
        }
    }

    // ------------------------------------------------------------------- state

    private JSONObject storeState(String storeId) throws Exception {
        JSONObject stores = state.getJSONObject("stores");
        if (!stores.has(storeId)) {
            JSONObject s = new JSONObject();
            s.put("nextOrderNumber", 1000);
            s.put("orders", new JSONArray());
            stores.put(storeId, s);
        }
        return stores.getJSONObject(storeId);
    }

    private void loadState() {
        try {
            File f = stateFile();
            if (f.exists()) {
                byte[] data = new byte[(int) f.length()];
                java.io.FileInputStream fis = new java.io.FileInputStream(f);
                int read = fis.read(data);
                fis.close();
                state = new JSONObject(new String(data, 0, Math.max(read, 0), StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {}
        try {
            if (state == null) state = new JSONObject();
            if (!state.has("stores")) state.put("stores", new JSONObject());
        } catch (Exception e) {
            try { state = new JSONObject().put("stores", new JSONObject()); } catch (Exception ignored) {}
        }
    }

    private void saveState() {
        try {
            File f = stateFile();
            java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
            fos.write(state.toString().getBytes(StandardCharsets.UTF_8));
            fos.close();
        } catch (Exception ignored) {}
    }

    private File stateFile() {
        return new File(getContext().getFilesDir(), "vido-hub-state.json");
    }

    private void trim(JSONArray orders, int max) {
        try {
            while (orders.length() > max) orders.remove(0);
        } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------------ helpers

    private void respond(OutputStream out, int status, String json) throws Exception {
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(" ").append(statusText(status)).append("\r\n");
        head.append("Content-Type: application/json\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET,POST,PATCH,OPTIONS\r\n");
        head.append("Access-Control-Allow-Headers: Content-Type\r\n");
        head.append("Content-Length: ").append(payload.length).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes(StandardCharsets.UTF_8));
        out.write(payload);
    }

    private String statusText(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 204: return "No Content";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            default:  return "Error";
        }
    }

    private String err(String msg) {
        try { return new JSONObject().put("ok", false).put("error", msg).toString(); }
        catch (Exception e) { return "{\"ok\":false}"; }
    }

    private boolean statusMatches(String orderStatus, String wantedCsv) {
        for (String w : wantedCsv.split(",")) {
            if (w.trim().equals(orderStatus)) return true;
        }
        return false;
    }

    private String queryParam(String query, String key) {
        if (query == null || query.isEmpty()) return null;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                String k = urlDecode(pair.substring(0, eq));
                if (k.equals(key)) return urlDecode(pair.substring(eq + 1));
            }
        }
        return null;
    }

    private String urlDecode(String s) {
        try { return URLDecoder.decode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    private String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int prev = -1, c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (prev == '\r') buf.write(prev);
            if (c != '\r') buf.write(c);
            prev = c;
        }
        if (c == -1 && buf.size() == 0) return null;
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    private String nowIso() {
        java.text.SimpleDateFormat f =
                new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return f.format(new java.util.Date());
    }

    /** Best-effort LAN IPv4 of this device (no special permission needed). */
    private String lanIp() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces.hasMoreElements()) {
                NetworkInterface iface = ifaces.nextElement();
                if (iface.isLoopback() || !iface.isUp()) continue;
                Enumeration<InetAddress> addrs = iface.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (!addr.isLoopbackAddress() && addr instanceof java.net.Inet4Address) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "";
    }
}

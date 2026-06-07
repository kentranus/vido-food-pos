package com.vido.food;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;

/**
 * Custom Capacitor plugin: raw TCP socket for BroadPOS communication.
 *
 * Methods:
 *   - connect({host, port, timeout}) -> {socketId}
 *   - send({socketId, data})  // data = base64 bytes
 *   - readLine({socketId, timeout}) -> {data}  // text until \n
 *   - readFrame({socketId, timeout, useLRC}) -> {data}  // skips ACK/NAK, reads STX frame
 *   - readBytes({socketId, count, timeout}) -> {data}  // base64; reads exactly N bytes
 *   - close({socketId})
 */
@CapacitorPlugin(name = "TcpSocket")
public class TcpSocketPlugin extends Plugin {

    private static final int STX = 0x02;
    private static final int ETX = 0x03;
    private static final int ACK = 0x06;
    private static final int NAK = 0x15;

    private final Map<String, Socket> sockets = new HashMap<>();
    private int nextId = 1;

    @PluginMethod
    public void connect(final PluginCall call) {
        final String host = call.getString("host");
        final Integer port = call.getInt("port");
        final Integer timeout = call.getInt("timeout", 5000);

        if (host == null || port == null) {
            call.reject("host and port required");
            return;
        }

        new Thread(() -> {
            try {
                Socket socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), timeout);
                socket.setTcpNoDelay(true);
                String id;
                synchronized (sockets) {
                    id = "sock_" + (nextId++) + "_" + System.currentTimeMillis();
                    sockets.put(id, socket);
                }
                JSObject ret = new JSObject();
                ret.put("socketId", id);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "connection failed" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void send(final PluginCall call) {
        final String id = call.getString("socketId");
        final String dataB64 = call.getString("data");

        if (id == null || dataB64 == null) {
            call.reject("socketId and data required");
            return;
        }

        final Socket socket;
        synchronized (sockets) { socket = sockets.get(id); }
        if (socket == null) {
            call.reject("socket not found");
            return;
        }

        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(dataB64, Base64.NO_WRAP);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                JSObject ret = new JSObject();
                ret.put("sent", bytes.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "send failed" : e.getMessage());
            }
        }).start();
    }

    /** Skips leading ACK bytes, then reads from STX through ETX and optional LRC. Returns base64. */
    @PluginMethod
    public void readFrame(final PluginCall call) {
        final String id = call.getString("socketId");
        final Integer timeout = call.getInt("timeout", 60000);
        final Boolean useLRC = call.getBoolean("useLRC", true);

        if (id == null) {
            call.reject("socketId required");
            return;
        }

        final Socket socket;
        synchronized (sockets) { socket = sockets.get(id); }
        if (socket == null) {
            call.reject("socket not found");
            return;
        }

        new Thread(() -> {
            try {
                socket.setSoTimeout(timeout);
                InputStream in = socket.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                int b;
                int skippedAck = 0;

                while ((b = in.read()) != -1) {
                    if (b == ACK) {
                        skippedAck++;
                        continue;
                    }
                    if (b == NAK) {
                        call.reject("card terminal returned NAK before response frame");
                        return;
                    }
                    if (b == STX) {
                        buffer.write(b);
                        break;
                    }
                }

                if (buffer.size() == 0) {
                    call.reject("connection closed before STX");
                    return;
                }

                boolean sawETX = false;
                while ((b = in.read()) != -1) {
                    buffer.write(b);
                    if (b == ETX) {
                        sawETX = true;
                        if (useLRC) {
                            int lrc = in.read();
                            if (lrc != -1) buffer.write(lrc);
                        }
                        break;
                    }
                    // Safety limit
                    if (buffer.size() > 8192) {
                        call.reject("frame too large");
                        return;
                    }
                }
                if (!sawETX) {
                    call.reject("connection closed before ETX");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
                ret.put("length", buffer.size());
                ret.put("skippedAck", skippedAck);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "read failed" : e.getMessage());
            }
        }).start();
    }

    /** Reads exactly `count` bytes. Returns base64. */
    @PluginMethod
    public void readBytes(final PluginCall call) {
        final String id = call.getString("socketId");
        final Integer count = call.getInt("count");
        final Integer timeout = call.getInt("timeout", 60000);

        if (id == null || count == null) {
            call.reject("socketId and count required");
            return;
        }

        final Socket socket;
        synchronized (sockets) { socket = sockets.get(id); }
        if (socket == null) {
            call.reject("socket not found");
            return;
        }

        new Thread(() -> {
            try {
                socket.setSoTimeout(timeout);
                InputStream in = socket.getInputStream();
                byte[] buf = new byte[count];
                int total = 0;
                while (total < count) {
                    int n = in.read(buf, total, count - total);
                    if (n == -1) break;
                    total += n;
                }
                byte[] out = new byte[total];
                System.arraycopy(buf, 0, out, 0, total);
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(out, Base64.NO_WRAP));
                ret.put("length", total);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "read failed" : e.getMessage());
            }
        }).start();
    }

    /** Reads until \n (legacy, for JSON-line protocols). */
    @PluginMethod
    public void readLine(final PluginCall call) {
        final String id = call.getString("socketId");
        final Integer timeout = call.getInt("timeout", 30000);

        if (id == null) {
            call.reject("socketId required");
            return;
        }

        final Socket socket;
        synchronized (sockets) { socket = sockets.get(id); }
        if (socket == null) {
            call.reject("socket not found");
            return;
        }

        new Thread(() -> {
            try {
                socket.setSoTimeout(timeout);
                InputStream in = socket.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                int b;
                while ((b = in.read()) != -1) {
                    if (b == '\n') break;
                    if (b == '\r') continue;
                    buffer.write(b);
                }
                String line = buffer.toString("UTF-8");
                JSObject ret = new JSObject();
                ret.put("data", line);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "read failed" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void close(final PluginCall call) {
        final String id = call.getString("socketId");
        if (id == null) {
            call.reject("socketId required");
            return;
        }

        Socket socket;
        synchronized (sockets) { socket = sockets.remove(id); }
        try {
            if (socket != null) socket.close();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "close failed" : e.getMessage());
        }
    }
}

package com.vido.food;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Base64;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.HashMap;
import org.json.JSONArray;

/**
 * Generic cash drawer bridge.
 *
 * Most cash drawers are opened by the receipt printer using ESC/POS pulse:
 * ESC p m t1 t2. For Android POS devices with a built-in drawer service,
 * vendors often expose a broadcast/action. This plugin supports both.
 */
@CapacitorPlugin(name = "CashDrawer")
public class CashDrawerPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "com.vido.food.USB_PERMISSION";

    private static final String[] COMMON_DRAWER_ACTIONS = new String[] {
        "com.android.CASH_DRAWER.OPEN",
        "com.pos.OPEN_CASH_DRAWER",
        "com.pos.cashdrawer.OPEN",
        "com.pos.printer.OPEN_CASH_DRAWER",
        "com.smartpos.cashdrawer.OPEN",
        "com.android.pos.OPEN_CASH_DRAWER",
        "com.android.action.CASH_DRAWER_OPEN",
        "com.sunmi.cashdrawer.OPEN",
        "woyou.aidlservice.jiuiv5.OPEN_CASH_DRAWER",
        "com.iposprinter.iposprinterservice.CASHBOX_OPEN",
        "net.nyx.printerservice.CASH_DRAWER",
        "com.vanstone.trans.api.CASH_DRAWER",
        "com.hoin.posprinter.OPEN_CASH_DRAWER",
        "com.gprinter.command.OPEN_CASH_DRAWER",
        "android.intent.action.OPEN_CASH_DRAWER"
    };

    @PluginMethod
    public void openCashDrawer(final PluginCall call) {
        final String mode = call.getString("mode", "android_intent");

        if ("network_escpos".equals(mode)) {
            openNetworkEscpos(call);
            return;
        }

        if ("usb_escpos".equals(mode)) {
            openUsbEscpos(call);
            return;
        }

        openAndroidIntent(call);
    }

    @PluginMethod
    public void getDeviceInfo(final PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("brand", Build.BRAND);
        ret.put("model", Build.MODEL);
        ret.put("device", Build.DEVICE);
        ret.put("product", Build.PRODUCT);
        ret.put("hardware", Build.HARDWARE);
        ret.put("board", Build.BOARD);
        ret.put("androidSdk", Build.VERSION.SDK_INT);
        ret.put("androidRelease", Build.VERSION.RELEASE);
        call.resolve(ret);
    }

    @PluginMethod
    public void listUsbDevices(final PluginCall call) {
        try {
            UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
            JSONArray devices = new JSONArray();
            HashMap<String, UsbDevice> deviceList = manager.getDeviceList();

            for (UsbDevice device : deviceList.values()) {
                JSObject d = new JSObject();
                d.put("deviceName", device.getDeviceName());
                d.put("vendorId", device.getVendorId());
                d.put("productId", device.getProductId());
                d.put("manufacturerName", Build.VERSION.SDK_INT >= 21 ? device.getManufacturerName() : "");
                d.put("productName", Build.VERSION.SDK_INT >= 21 ? device.getProductName() : "");
                d.put("interfaceCount", device.getInterfaceCount());
                d.put("hasPermission", manager.hasPermission(device));
                devices.put(d);
            }

            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "USB device scan failed" : e.getMessage());
        }
    }

    @PluginMethod
    public void writeUsbEscpos(final PluginCall call) {
        final String dataB64 = call.getString("data");
        final Integer targetVendorId = call.getInt("usbVendorId", 0);
        final Integer targetProductId = call.getInt("usbProductId", 0);

        if (dataB64 == null || dataB64.trim().isEmpty()) {
            call.reject("ESC/POS data is required");
            return;
        }

        final byte[] payload;
        try {
            payload = Base64.decode(dataB64, Base64.NO_WRAP);
        } catch (Exception e) {
            call.reject("Invalid base64 ESC/POS data");
            return;
        }

        new Thread(() -> {
            UsbDeviceConnection connection = null;
            try {
                UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
                UsbDevice device = findUsbPrinter(manager, targetVendorId, targetProductId);

                if (device == null) {
                    call.reject("No USB printer found. Plug in printer, then try Scan USB Devices.");
                    return;
                }

                if (!manager.hasPermission(device)) {
                    requestUsbPermission(manager, device);
                    call.reject("USB permission requested. Approve it on the POS, then tap Print Receipt again.");
                    return;
                }

                UsbInterface usbInterface = findBulkOutInterface(device);
                UsbEndpoint outEndpoint = findBulkOutEndpoint(usbInterface);

                if (usbInterface == null || outEndpoint == null) {
                    call.reject("USB printer output endpoint not found");
                    return;
                }

                connection = manager.openDevice(device);
                if (connection == null) {
                    call.reject("Could not open USB printer");
                    return;
                }

                if (!connection.claimInterface(usbInterface, true)) {
                    call.reject("Could not claim USB printer interface");
                    return;
                }

                int sent = 0;
                int offset = 0;
                while (offset < payload.length) {
                    int chunk = Math.min(1024, payload.length - offset);
                    byte[] slice = new byte[chunk];
                    System.arraycopy(payload, offset, slice, 0, chunk);
                    int n = connection.bulkTransfer(outEndpoint, slice, slice.length, 5000);
                    if (n <= 0) break;
                    sent += n;
                    offset += n;
                }

                connection.releaseInterface(usbInterface);

                if (sent < payload.length) {
                    call.reject("USB printer write incomplete: sent " + sent + " of " + payload.length + " bytes");
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("mode", "usb_escpos_print");
                ret.put("deviceName", device.getDeviceName());
                ret.put("vendorId", device.getVendorId());
                ret.put("productId", device.getProductId());
                ret.put("sent", sent);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "USB receipt print failed" : e.getMessage());
            } finally {
                if (connection != null) connection.close();
            }
        }).start();
    }

    private void openNetworkEscpos(final PluginCall call) {
        final String host = call.getString("printerHost");
        final Integer port = call.getInt("printerPort", 9100);
        final Integer pulsePin = call.getInt("pulsePin", 0);
        final Integer pulseOnMs = call.getInt("pulseOnMs", 25);
        final Integer pulseOffMs = call.getInt("pulseOffMs", 250);

        if (host == null || host.trim().isEmpty()) {
            call.reject("Printer IP is required for network ESC/POS cash drawer");
            return;
        }

        new Thread(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), 5000);
                socket.setTcpNoDelay(true);

                byte pin = (byte) (pulsePin == 1 ? 1 : 0);
                byte on = (byte) Math.max(1, Math.min(255, pulseOnMs / 2));
                byte off = (byte) Math.max(1, Math.min(255, pulseOffMs / 2));
                byte[] pulse = new byte[] { 0x1B, 0x70, pin, on, off };

                OutputStream out = socket.getOutputStream();
                out.write(pulse);
                out.flush();

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("mode", "network_escpos");
                ret.put("sent", Base64.encodeToString(pulse, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "cash drawer open failed" : e.getMessage());
            }
        }).start();
    }

    private void openUsbEscpos(final PluginCall call) {
        final Integer targetVendorId = call.getInt("usbVendorId", 0);
        final Integer targetProductId = call.getInt("usbProductId", 0);
        final Integer pulsePin = call.getInt("pulsePin", 0);
        final Integer pulseOnMs = call.getInt("pulseOnMs", 25);
        final Integer pulseOffMs = call.getInt("pulseOffMs", 250);

        new Thread(() -> {
            UsbDeviceConnection connection = null;
            try {
                UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
                UsbDevice device = findUsbPrinter(manager, targetVendorId, targetProductId);

                if (device == null) {
                    call.reject("No USB printer found. Plug in printer, then try Scan USB Devices.");
                    return;
                }

                if (!manager.hasPermission(device)) {
                    Intent intent = new Intent(ACTION_USB_PERMISSION);
                    requestUsbPermission(manager, device);
                    call.reject("USB permission requested. Approve it on the POS, then tap Test Open Drawer again.");
                    return;
                }

                UsbInterface usbInterface = findBulkOutInterface(device);
                UsbEndpoint outEndpoint = findBulkOutEndpoint(usbInterface);

                if (usbInterface == null || outEndpoint == null) {
                    call.reject("USB printer output endpoint not found");
                    return;
                }

                connection = manager.openDevice(device);
                if (connection == null) {
                    call.reject("Could not open USB printer");
                    return;
                }

                if (!connection.claimInterface(usbInterface, true)) {
                    call.reject("Could not claim USB printer interface");
                    return;
                }

                byte pin = (byte) (pulsePin == 1 ? 1 : 0);
                byte on = (byte) Math.max(1, Math.min(255, pulseOnMs / 2));
                byte off = (byte) Math.max(1, Math.min(255, pulseOffMs / 2));
                byte[] pulse = new byte[] { 0x1B, 0x70, pin, on, off };
                int sent = connection.bulkTransfer(outEndpoint, pulse, pulse.length, 3000);

                connection.releaseInterface(usbInterface);

                if (sent < pulse.length) {
                    call.reject("USB cash drawer pulse was not fully sent");
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("mode", "usb_escpos");
                ret.put("deviceName", device.getDeviceName());
                ret.put("vendorId", device.getVendorId());
                ret.put("productId", device.getProductId());
                ret.put("sent", Base64.encodeToString(pulse, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "USB cash drawer open failed" : e.getMessage());
            } finally {
                if (connection != null) connection.close();
            }
        }).start();
    }

    private UsbDevice findUsbPrinter(UsbManager manager, int targetVendorId, int targetProductId) {
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        UsbDevice firstWithBulkOut = null;

        for (UsbDevice device : deviceList.values()) {
            if (targetVendorId > 0 && device.getVendorId() != targetVendorId) continue;
            if (targetProductId > 0 && device.getProductId() != targetProductId) continue;

            for (int i = 0; i < device.getInterfaceCount(); i++) {
                UsbInterface usbInterface = device.getInterface(i);
                for (int e = 0; e < usbInterface.getEndpointCount(); e++) {
                    UsbEndpoint endpoint = usbInterface.getEndpoint(e);
                    if (endpoint.getDirection() == UsbConstants.USB_DIR_OUT
                        && endpoint.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                        return device;
                    }
                }
            }

            if (firstWithBulkOut == null) firstWithBulkOut = device;
        }

        return firstWithBulkOut;
    }

    private void requestUsbPermission(UsbManager manager, UsbDevice device) {
        Intent intent = new Intent(ACTION_USB_PERMISSION);
        PendingIntent permissionIntent = PendingIntent.getBroadcast(
            getContext(),
            0,
            intent,
            Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0
        );
        manager.requestPermission(device, permissionIntent);
    }

    private UsbInterface findBulkOutInterface(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface usbInterface = device.getInterface(i);
            if (findBulkOutEndpoint(usbInterface) != null) return usbInterface;
        }
        return null;
    }

    private UsbEndpoint findBulkOutEndpoint(UsbInterface usbInterface) {
        if (usbInterface == null) return null;
        for (int e = 0; e < usbInterface.getEndpointCount(); e++) {
            UsbEndpoint endpoint = usbInterface.getEndpoint(e);
            if (endpoint.getDirection() == UsbConstants.USB_DIR_OUT
                && endpoint.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                return endpoint;
            }
        }
        return null;
    }

    private void openAndroidIntent(final PluginCall call) {
        try {
            String customAction = call.getString("customIntentAction", "");
            int sent = 0;

            if (customAction != null && !customAction.trim().isEmpty()) {
                sendDrawerBroadcast(customAction.trim());
                sent++;
            }

            for (String action : COMMON_DRAWER_ACTIONS) {
                sendDrawerBroadcast(action);
                sent++;
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("mode", "android_intent");
            ret.put("broadcastsSent", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "cash drawer broadcast failed" : e.getMessage());
        }
    }

    private void sendDrawerBroadcast(String action) {
        Intent intent = new Intent(action);
        intent.setPackage(getContext().getPackageName());
        getContext().sendBroadcast(intent);

        Intent globalIntent = new Intent(action);
        getContext().sendBroadcast(globalIntent);
    }
}

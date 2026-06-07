package com.vido.food;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.pax.poslink.CommSetting;
import com.pax.poslink.LogSetting;
import com.pax.poslink.PaymentRequest;
import com.pax.poslink.PaymentResponse;
import com.pax.poslink.POSLinkAndroid;
import com.pax.poslink.PosLink;
import com.pax.poslink.ProcessTransResult;

@CapacitorPlugin(name = "PosLinkPayment")
public class PosLinkPaymentPlugin extends Plugin {

    private volatile boolean initialized = false;

    @PluginMethod
    public void init(final PluginCall call) {
        try {
            ensureInitialized();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("sdk", "POSLink Java Android V1.17.00 20260202");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    @PluginMethod
    public void sale(final PluginCall call) {
        final Double amount = call.getDouble("amount");
        final String connectionMode = call.getString("connectionMode", "tcp");
        final String host = call.getString("host");
        final Integer port = call.getInt("port", 10009);
        final Integer timeout = call.getInt("timeout", 60000);
        final String refNum = call.getString("refNum", String.valueOf(System.currentTimeMillis()));
        final String tipAmount = call.getString("tipAmount", "");
        final String extData = call.getString("extData", "");

        if (amount == null || amount <= 0) {
            call.reject("amount required");
            return;
        }
        if ("tcp".equalsIgnoreCase(connectionMode) && (host == null || host.trim().isEmpty())) {
            call.reject("payment terminal IP required");
            return;
        }

        new Thread(() -> {
            try {
                ensureInitialized();

                PosLink posLink = new PosLink(getContext());
                posLink.SetCommSetting(buildCommSetting(connectionMode, host, port, timeout));

                PaymentRequest request = new PaymentRequest();
                request.TenderType = request.ParseTenderType("CREDIT");
                request.TransType = request.ParseTransType("SALE");
                request.ECRRefNum = refNum;
                request.Amount = cents(amount);
                if (tipAmount != null && !tipAmount.trim().isEmpty()) {
                    request.TipAmt = tipAmount;
                }
                if (extData != null && !extData.trim().isEmpty()) {
                    request.ExtData = extData;
                }

                posLink.PaymentRequest = request;
                ProcessTransResult result = posLink.ProcessTrans();

                JSObject ret = new JSObject();
                ret.put("ok", result.Code == ProcessTransResult.ProcessTransResultCode.OK);
                ret.put("processCode", String.valueOf(result.Code));
                ret.put("processMessage", result.Msg);

                if (result.Code == ProcessTransResult.ProcessTransResultCode.OK) {
                    PaymentResponse response = posLink.PaymentResponse;
                    ret.put("approved", "000000".equals(response.ResultCode) || "000".equals(response.ResultCode));
                    ret.put("resultCode", response.ResultCode);
                    ret.put("resultText", response.ResultTxt);
                    ret.put("message", response.Message);
                    ret.put("authCode", response.AuthCode);
                    ret.put("refNum", response.RefNum);
                    ret.put("requestedAmount", response.RequestedAmount);
                    ret.put("approvedAmount", response.ApprovedAmount);
                    ret.put("cardType", response.CardType);
                    ret.put("maskedCard", response.BogusAccountNum);
                    ret.put("hostCode", response.HostCode);
                    ret.put("hostResponse", response.HostResponse);
                    ret.put("timestamp", response.Timestamp);
                    ret.put("rawResponse", response.RawResponse);
                    ret.put("extData", response.ExtData);
                }

                call.resolve(ret);
            } catch (Exception e) {
                call.reject(message(e));
            }
        }).start();
    }

    private synchronized void ensureInitialized() {
        if (initialized) return;
        java.io.File externalDir = getContext().getExternalFilesDir(null);
        String logPath = externalDir == null
                ? getContext().getFilesDir().getAbsolutePath()
                : externalDir.getAbsolutePath();
        LogSetting.setLogMode(true);
        LogSetting.setLevel(LogSetting.LOGLEVEL.DEBUG);
        LogSetting.setLogFileName("POSLinkLog");
        LogSetting.setOutputPath(logPath);
        LogSetting.setLogDays("30");
        POSLinkAndroid.init(getContext().getApplicationContext());
        initialized = true;
    }

    private CommSetting buildCommSetting(String connectionMode, String host, int port, int timeout) {
        CommSetting setting = new CommSetting();
        setting.setTimeOut(String.valueOf(timeout));
        if ("usb".equalsIgnoreCase(connectionMode)) {
            setting.setType(CommSetting.USB);
            return setting;
        }
        setting.setType(CommSetting.TCP);
        setting.setDestIP(host);
        setting.setDestPort(String.valueOf(port));
        return setting;
    }

    private String cents(double amount) {
        return String.valueOf(Math.round(amount * 100.0d));
    }

    private String message(Exception e) {
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }
}

package com.vido.food;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "CustomerDisplay")
public class CustomerDisplayPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private CustomerPresentation presentation;
    private String lastJson = "{\"state\":\"idle\"}";

    @PluginMethod
    public void listDisplays(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("displays", buildDisplayList());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    @PluginMethod
    public void show(final PluginCall call) {
        final Integer requestedId = call.getInt("displayId");
        main.post(() -> {
            try {
                Display target = findTargetDisplay(requestedId);
                if (target == null) {
                    call.reject("No secondary display available");
                    return;
                }
                if (presentation != null) presentation.dismiss();
                presentation = new CustomerPresentation(getContext(), target);
                presentation.show();
                presentation.pushState(lastJson);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("displayId", target.getDisplayId());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(message(e));
            }
        });
    }

    @PluginMethod
    public void hide(final PluginCall call) {
        main.post(() -> {
            try {
                if (presentation != null) presentation.dismiss();
                presentation = null;
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(message(e));
            }
        });
    }

    @PluginMethod
    public void update(final PluginCall call) {
        final String json = call.getString("json", "{}");
        lastJson = json;
        main.post(() -> {
            try {
                if (presentation != null) presentation.pushState(json);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("delivered", presentation != null);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(message(e));
            }
        });
    }

    @PluginMethod
    public void isShowing(final PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("showing", presentation != null && presentation.isShowing());
        call.resolve(ret);
    }

    private Display findTargetDisplay(Integer requestedId) {
        DisplayManager dm = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        Display[] displays = dm.getDisplays();
        if (requestedId != null) {
            for (Display display : displays) {
                if (display.getDisplayId() == requestedId && display.getDisplayId() != Display.DEFAULT_DISPLAY) {
                    return display;
                }
            }
        }
        Display[] presentationDisplays = dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        if (presentationDisplays.length > 0) return presentationDisplays[0];
        for (Display display : displays) {
            if (display.getDisplayId() != Display.DEFAULT_DISPLAY) return display;
        }
        return null;
    }

    private JSArray buildDisplayList() {
        DisplayManager dm = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        Display[] presentationDisplays = dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        Set<Integer> presentationIds = new HashSet<>();
        for (Display display : presentationDisplays) presentationIds.add(display.getDisplayId());

        JSArray list = new JSArray();
        for (Display display : dm.getDisplays()) {
            Point size = new Point();
            try { display.getRealSize(size); } catch (Exception ignored) {}
            JSObject item = new JSObject();
            item.put("id", display.getDisplayId());
            item.put("name", display.getName() == null ? "Display " + display.getDisplayId() : display.getName());
            item.put("isPrimary", display.getDisplayId() == Display.DEFAULT_DISPLAY);
            item.put("isPresentation", presentationIds.contains(display.getDisplayId()));
            item.put("width", size.x);
            item.put("height", size.y);
            list.put(item);
        }
        return list;
    }

    private String message(Exception e) {
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    private static class CustomerPresentation extends Presentation {
        private WebView webView;
        private boolean ready = false;
        private String queuedJson;

        CustomerPresentation(Context context, Display display) {
            super(context, display);
        }

        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            if (getWindow() != null) {
                getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.parseColor("#101318")));
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    getWindow().setDecorFitsSystemWindows(false);
                } else {
                    getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    );
                }
            }

            webView = new WebView(getContext());
            webView.setBackgroundColor(Color.parseColor("#101318"));
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ));
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    ready = true;
                    if (queuedJson != null) {
                        pushState(queuedJson);
                        queuedJson = null;
                    }
                }
            });
            webView.loadDataWithBaseURL(null, html(), "text/html", "utf-8", null);
            setContentView(webView);
        }

        void pushState(String json) {
            if (!ready) {
                queuedJson = json;
                return;
            }
            String literal = json
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "");
            webView.post(() -> webView.evaluateJavascript("window.updateDisplay('" + literal + "')", null));
        }

        @Override
        public void dismiss() {
            try {
                if (webView != null) webView.destroy();
            } catch (Exception ignored) {}
            super.dismiss();
        }

        private static String html() {
            return "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'/>"
                + "<style>body{margin:0;background:#101318;color:#f8fafc;font-family:Arial,sans-serif;height:100vh;overflow:hidden}"
                + ".wrap{height:100vh;padding:42px;box-sizing:border-box;display:flex;flex-direction:column}.brand{font-size:34px;font-weight:900;color:#facc15}"
                + ".state{font-size:18px;color:#9ca3af;text-transform:uppercase;font-weight:800;margin-top:4px}.items{flex:1;margin-top:30px;overflow:hidden}"
                + ".item{display:grid;grid-template-columns:1fr 72px 120px;gap:18px;padding:18px 0;border-bottom:1px solid #2b313a;font-size:28px;font-weight:800}"
                + ".detail{font-size:16px;color:#9ca3af;margin-top:5px}.total{border-top:3px solid #facc15;padding-top:24px;font-size:56px;font-weight:900;display:flex;justify-content:space-between}"
                + ".sub{font-size:22px;color:#d1d5db;display:flex;justify-content:space-between;margin:8px 0}.center{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;font-size:42px;font-weight:900}"
                + "</style></head><body><div class='wrap'><div><div class='brand' id='shop'>Vido Food</div><div class='state' id='state'>Welcome</div></div><div id='content' class='center'>Welcome</div></div>"
                + "<script>function money(n){return '$'+Number(n||0).toFixed(2)};"
                + "window.updateDisplay=function(raw){var d=JSON.parse(raw||'{}');document.getElementById('shop').textContent=(d.shop&&d.shop.name)||'Vido Food';"
                + "var state=document.getElementById('state'),c=document.getElementById('content');"
                + "if(d.state==='payment'){state.textContent='Payment';c.className='center';c.innerHTML='<div>Total Due<br><span style=\"color:#facc15;font-size:72px\">'+money(d.total)+'</span><br><span style=\"font-size:24px;color:#9ca3af\">'+(d.method||'Payment')+'</span></div>';return;}"
                + "if(d.state==='done'){state.textContent='Paid';c.className='center';c.innerHTML='<div style=\"color:#22c55e\">Thank you!</div><div style=\"font-size:34px;margin-top:18px\">'+money(d.total)+'</div>';return;}"
                + "if(!d.items||!d.items.length){state.textContent='Welcome';c.className='center';c.textContent='Welcome';return;}"
                + "state.textContent='Order #'+(d.orderNumber||'');c.className='items';c.innerHTML=d.items.map(function(i){return '<div class=\"item\"><div>'+(i.emoji||'')+' '+i.name+'<div class=\"detail\">'+(i.details||'')+'</div></div><div>x'+i.qty+'</div><div>'+money(i.total)+'</div></div>'}).join('')"
                + "+'<div style=\"margin-top:22px\"><div class=\"sub\"><span>Subtotal</span><span>'+money(d.subtotal)+'</span></div><div class=\"sub\"><span>Tax</span><span>'+money(d.tax)+'</span></div><div class=\"total\"><span>Total</span><span>'+money(d.total)+'</span></div></div>';};"
                + "window.updateDisplay('{\"state\":\"idle\"}');</script></body></html>";
        }
    }
}

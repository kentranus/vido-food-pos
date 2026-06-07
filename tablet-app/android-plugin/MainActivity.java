package com.vido.food;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE super.onCreate
        registerPlugin(TcpSocketPlugin.class);
        registerPlugin(CashDrawerPlugin.class);
        registerPlugin(PosLinkPaymentPlugin.class);
        registerPlugin(CustomerDisplayPlugin.class);
        registerPlugin(EmbeddedHubPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

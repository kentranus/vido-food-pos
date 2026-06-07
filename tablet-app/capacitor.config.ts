import { CapacitorConfig } from '@capacitor/cli';

// One unified app — POS vs Kiosk is now a per-device runtime setting
// (see src/services/modeStorage.js), not a separate build/appId.
const config: CapacitorConfig = {
  appId: 'com.vido.food',
  appName: 'Vido Food',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#FFCC00',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#FFCC00',
    },
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;

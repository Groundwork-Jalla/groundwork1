import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for wrapping the Groundwork React/Vite SPA (`build/client`)
 * into a single unified iOS & Android app (Homeowner, Contractor, and Supplier roles).
 * See `docs/mobile-capacitor-setup.md` for iOS & Android build commands.
 */
const config: CapacitorConfig = {
  appId: 'com.tryjalla.groundwork',
  appName: 'Groundwork',
  webDir: 'build/client',
  server: {
    // Serves Android WebView over https://localhost so cookies, crypto.subtle,
    // and Supabase PKCE auth behave like production HTTPS.
    androidScheme: 'https',
    iosScheme: 'capacitor',
    allowNavigation: ['tryjalla.com', '*.tryjalla.com', '*.supabase.co'],
  },
  ios: {
    // Let Groundwork's own CSS `env(safe-area-inset-*)` classes manage notch & home indicator padding.
    contentInset: 'never',
    backgroundColor: '#1f4d36',
  },
  android: {
    backgroundColor: '#1f4d36',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#1f4d36',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#ffffff',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bizzybee.app',
  appName: 'BizzyBee',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#FFFFFF',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#FFFFFF',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  server: {
    // In development, point to the Vite dev server
    ...(process.env.NODE_ENV === 'development' && {
      url: 'http://localhost:8080',
      cleartext: true,
    }),
  },
};

export default config;

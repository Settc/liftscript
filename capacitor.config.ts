import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourdomain.liftscript', // TODO: Replace with your actual domain
  appName: 'LiftScript',
  webDir: 'dist',
  // Uncomment for local dev:
  // server: {
  //   url: 'http://YOUR_LOCAL_IP:5173',
  //   cleartext: true
  // }
};

export default config;

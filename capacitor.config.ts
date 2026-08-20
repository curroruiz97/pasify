import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "es.pasify.app",
  appName: "Pasify",
  webDir: "dist",
  // Background bianco di default → settiamo nero Pasify così niente flash bianco
  // al boot prima che React monti.
  backgroundColor: "#0F0F0F",
  android: {
    allowMixedContent: false,
    captureInput: true,
    // Debugging vía chrome://inspect SOLO en debug builds. En release (la APK
    // firmada que distribuyes) debe ser false para no exponer la WebView a
    // un inspector remoto en un dispositivo robado o comprometido.
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: "always",
    // Pasify usa il dark theme di default
    backgroundColor: "#0F0F0F",
  },
  plugins: {
    GoogleAuth: {
      scopes: ["profile", "email"],
      iosClientId: "899901016052-5ltqfpu3qa3a9k9lu140n42s6lgqt476.apps.googleusercontent.com",
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0F0F0F",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    PrivacyScreen: {
      enable: false, // attivato a runtime solo quando si apre il modal QR
    },
  },
};

export default config;

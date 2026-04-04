import { Capacitor } from '@capacitor/core';

/**
 * Native capability wrappers.
 * These work on both web and native — they no-op gracefully on web.
 */

/** Whether the app is running inside a native shell (iOS/Android) */
export const isNative = Capacitor.isNativePlatform();

/** Current platform: 'ios' | 'android' | 'web' */
export const platform = Capacitor.getPlatform();

/** Configure status bar for native platforms */
export async function configureStatusBar() {
  if (!isNative) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Light });
  if (platform === 'android') {
    await StatusBar.setBackgroundColor({ color: '#FFFFFF' });
  }
}

/** Configure keyboard behavior for native platforms */
export async function configureKeyboard() {
  if (!isNative) return;
  const { Keyboard } = await import('@capacitor/keyboard');
  Keyboard.addListener('keyboardWillShow', () => {
    document.body.classList.add('keyboard-open');
  });
  Keyboard.addListener('keyboardWillHide', () => {
    document.body.classList.remove('keyboard-open');
  });
}

/** Register for push notifications */
export async function registerPushNotifications() {
  if (!isNative) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return null;

  await PushNotifications.register();

  return new Promise<string | null>((resolve) => {
    PushNotifications.addListener('registration', (token) => {
      resolve(token.value);
    });
    PushNotifications.addListener('registrationError', () => {
      resolve(null);
    });
  });
}

/** Trigger haptic feedback */
export async function hapticFeedback(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (!isNative) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  const styleMap = {
    light: ImpactStyle.Light,
    medium: ImpactStyle.Medium,
    heavy: ImpactStyle.Heavy,
  };
  await Haptics.impact({ style: styleMap[style] });
}

/** Initialize all native capabilities */
export async function initNative() {
  if (!isNative) return;
  await configureStatusBar();
  await configureKeyboard();
}

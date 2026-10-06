import { Capacitor } from '@capacitor/core';

export type PlatformKind = 'desktop' | 'android' | 'ios' | 'web';

/** Desktop = Electron (preload bridge present); android/ios = Capacitor shell; otherwise a plain browser. */
export function platformKind(): PlatformKind {
  if (window.slack) return 'desktop';
  const native = Capacitor.getPlatform();
  return native === 'android' || native === 'ios' ? native : 'web';
}

export const isMobile = (): boolean => {
  const kind = platformKind();
  return kind === 'android' || kind === 'ios';
};

/** Sensible default server address: the Android emulator reaches the host machine at 10.0.2.2. */
export function defaultServerUrl(): string {
  return platformKind() === 'android' ? 'ws://10.0.2.2:3001' : 'ws://localhost:3001';
}

/** Accepts "host:port", "http(s)://…" or "ws(s)://…" and returns a WebSocket URL. */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return url;
  if (/^http:\/\//i.test(url)) url = url.replace(/^http/i, 'ws');
  else if (/^https:\/\//i.test(url)) url = url.replace(/^https/i, 'wss');
  else if (!/^wss?:\/\//i.test(url)) url = `ws://${url}`;
  return url;
}

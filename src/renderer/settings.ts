/** Per-device app preferences, stored in localStorage and applied to the document. */

export type Theme = 'dark' | 'light' | 'system';
export type ClockFormat = 'auto' | '12' | '24';

export interface AppSettings {
  theme: Theme;
  /** Base font size in px. */
  fontSize: number;
  compact: boolean;
  clock: ClockFormat;
  notifications: boolean;
}

export const FONT_SIZE_RANGE = { min: 12, max: 20 } as const;

const STORAGE_KEY = 'slack.settings';
const DEFAULTS: AppSettings = {
  theme: 'dark',
  fontSize: 15,
  compact: false,
  clock: 'auto',
  notifications: false
};

const listeners = new Set<(settings: AppSettings) => void>();
let current: AppSettings = load();

function load(): AppSettings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULTS };
  }
}

function sanitize(raw: Partial<AppSettings>): AppSettings {
  const size = Number(raw.fontSize);
  return {
    theme: raw.theme === 'light' || raw.theme === 'system' ? raw.theme : 'dark',
    fontSize: Number.isFinite(size)
      ? Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, Math.round(size)))
      : DEFAULTS.fontSize,
    compact: raw.compact === true,
    clock: raw.clock === '12' || raw.clock === '24' ? raw.clock : 'auto',
    notifications: raw.notifications === true
  };
}

export const getSettings = (): AppSettings => current;

export function updateSettings(patch: Partial<AppSettings>): void {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable (private mode); the settings still apply for this session.
  }
  applySettings();
  listeners.forEach((listener) => listener(current));
}

export function resetSettings(): void {
  updateSettings({ ...DEFAULTS });
}

export function onSettingsChange(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

/** Writes the current settings to the document (theme attribute, font size, density). */
export function applySettings(): void {
  const light = current.theme === 'light' || (current.theme === 'system' && lightQuery.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.documentElement.style.setProperty('--font-size', `${current.fontSize}px`);
  document.body.classList.toggle('compact', current.compact);
}

lightQuery.addEventListener('change', () => {
  if (current.theme === 'system') applySettings();
});

// ------------------------------------------------------------ notifications

export const notificationsSupported = (): boolean => 'Notification' in window;

/** Asks for permission if needed. Resolves to whether notifications may be shown. */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  return Notification.permission === 'granted';
}

/** Shows a notification when notifications are on and the app isn't in the foreground. */
export function notify(title: string, body: string): void {
  if (!current.notifications || !notificationsSupported() || Notification.permission !== 'granted') return;
  if (document.hasFocus() && !document.hidden) return;
  try {
    new Notification(title, { body });
  } catch {
    // Some webviews expose Notification but throw when constructing one.
  }
}

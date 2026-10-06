import './styles.css';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { createChatView } from './chat';
import { clear, el } from './dom';
import { Gateway } from './gateway';
import { createLoginView } from './login';
import { defaultServerUrl, normalizeServerUrl } from './platform';
import { applySettings } from './settings';
import type { PublicUser } from '../shared/protocol';
import type { View } from './view';

const PREFS_KEY = 'slack.prefs';

interface Prefs {
  serverUrl: string;
  token: string | null;
}

function loadPrefs(): Prefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { serverUrl: parsed.serverUrl || defaultServerUrl(), token: parsed.token ?? null };
  } catch {
    return { serverUrl: defaultServerUrl(), token: null };
  }
}

function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

applySettings();

const root = document.getElementById('app') as HTMLElement;
const gateway = new Gateway();
let prefs = loadPrefs();
let view: View | null = null;
let wasReconnecting = false;

/** Tears down the current view before building the next one, since both draw into the same root. */
function setView(create: () => View): void {
  view?.destroy();
  view = create();
}

gateway.onStatus = (status) => {
  view?.handleStatus?.(status);
  // After a dropped connection, the socket is new and must authenticate again.
  if (status === 'reconnecting') wasReconnecting = true;
  if (status === 'open' && wasReconnecting) {
    wasReconnecting = false;
    if (prefs.token) gateway.send({ type: 'resume', token: prefs.token });
  }
};

function showLogin(notice?: string): void {
  gateway.close();
  wasReconnecting = false;
  setView(() =>
    createLoginView(root, {
      serverUrl: prefs.serverUrl,
      notice,
      onSubmit: (mode, serverUrl, username, password) => authenticate(mode, serverUrl, username, password)
    })
  );
}

function showChat(user: PublicUser): void {
  setView(() =>
    createChatView(root, {
      user,
      gateway,
      serverUrl: prefs.serverUrl,
      onLogout() {
        gateway.send({ type: 'logout' });
        prefs = { ...prefs, token: null };
        savePrefs(prefs);
        showLogin();
      }
    })
  );
  // The server sends `ready` right after `auth_ok`; route it to the chat view.
  gateway.onEvent = (event) => {
    if (event.type === 'error' && event.code === 'invalid_token') {
      prefs = { ...prefs, token: null };
      savePrefs(prefs);
      showLogin(event.message);
      return;
    }
    view?.handleEvent?.(event);
  };
}

/** Connects, authenticates and, on success, swaps the login screen for the chat. Resolves to an error message or null. */
async function authenticate(
  mode: 'login' | 'register' | 'resume',
  serverUrl: string,
  username = '',
  password = ''
): Promise<string | null> {
  serverUrl = normalizeServerUrl(serverUrl);
  try {
    await gateway.connect(serverUrl);
  } catch (error) {
    return (error as Error).message;
  }

  return new Promise((resolve) => {
    gateway.onEvent = (event) => {
      if (event.type === 'auth_ok') {
        prefs = { serverUrl, token: event.token };
        savePrefs(prefs);
        showChat(event.user);
        resolve(null);
      } else if (event.type === 'error') {
        if (event.code === 'invalid_token') {
          prefs = { ...prefs, token: null };
          savePrefs(prefs);
        }
        gateway.close();
        resolve(event.message);
      }
    };
    if (mode === 'resume') {
      if (prefs.token) gateway.send({ type: 'resume', token: prefs.token });
    } else {
      gateway.send({ type: mode, username, password });
    }
  });
}

async function start(): Promise<void> {
  if (!prefs.token) return showLogin();

  clear(root);
  root.append(el('div', { class: 'splash' }, 'Connecting…'));

  const error = await authenticate('resume', prefs.serverUrl);
  if (error) showLogin(error);
}

void start();

// Android hardware/gesture back: close dialogs and drawers first, then send the app to the background.
if (Capacitor.isNativePlatform()) {
  void App.addListener('backButton', () => {
    if (!view?.handleBack?.()) void App.minimizeApp();
  });
}

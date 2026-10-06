import { LIMITS } from '../shared/protocol';
import { clear, el } from './dom';
import { isMobile } from './platform';
import type { View } from './view';

export interface LoginOptions {
  serverUrl: string;
  notice?: string;
  /** Resolves to an error message, or null on success. */
  onSubmit(
    mode: 'login' | 'register',
    serverUrl: string,
    username: string,
    password: string
  ): Promise<string | null>;
}

export function createLoginView(root: HTMLElement, options: LoginOptions): View {
  const server = el('input', {
    id: 'server',
    type: 'text',
    value: options.serverUrl,
    spellcheck: false,
    autocomplete: 'off'
  });
  const username = el('input', {
    id: 'username',
    type: 'text',
    maxlength: LIMITS.usernameMax,
    autocomplete: 'username'
  });
  const password = el('input', {
    id: 'password',
    type: 'password',
    maxlength: LIMITS.passwordMax,
    autocomplete: 'current-password'
  });
  const message = el('p', { class: 'form-message', role: 'alert' }, options.notice ?? '');
  const loginButton = el('button', { class: 'btn primary', type: 'submit' }, 'Log in');
  const registerButton = el('button', { class: 'btn secondary', type: 'button' }, 'Create account');
  const version = el('span', { class: 'version' });

  let busy = false;
  async function submit(mode: 'login' | 'register'): Promise<void> {
    if (busy) return;
    busy = true;
    loginButton.disabled = registerButton.disabled = true;
    message.textContent = 'Connecting…';
    const error = await options.onSubmit(mode, server.value.trim(), username.value, password.value);
    // On success the app swaps this view out, so only failures reach this point.
    busy = false;
    loginButton.disabled = registerButton.disabled = false;
    message.textContent = error ?? '';
  }

  registerButton.addEventListener('click', () => void submit('register'));

  const form = el(
    'form',
    {
      class: 'login-card',
      onsubmit: (event: Event) => {
        event.preventDefault();
        void submit('login');
      }
    },
    el('img', { class: 'login-logo', src: 'logo.svg', alt: '' }),
    el('h1', {}, 'Welcome to Slack'),
    el('p', { class: 'muted' }, 'Talk with your communities in real time.'),
    el('label', { for: 'server' }, 'Server'),
    server,
    isMobile()
      ? el('p', { class: 'muted hint' }, "On a phone, use your computer's address, e.g. 192.168.1.20:3001.")
      : null,
    el('label', { for: 'username' }, 'Username'),
    username,
    el('label', { for: 'password' }, 'Password'),
    password,
    message,
    el('div', { class: 'row' }, loginButton, registerButton),
    version
  );
  clear(root);
  root.append(el('div', { class: 'login-screen' }, form));
  (options.serverUrl ? username : server).focus();

  void window.slack?.getVersion().then((v) => {
    version.textContent = `v${v}`;
  });

  return { destroy: () => clear(root) };
}

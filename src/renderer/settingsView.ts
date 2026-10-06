import { AVATAR_COLORS, LIMITS, type PublicUser, type ServerEvent } from '../shared/protocol';
import { avatar } from './avatar';
import { el } from './dom';
import type { Gateway } from './gateway';
import { icon, type IconName } from './icons';
import { openModal, toast } from './modal';
import { platformKind } from './platform';
import {
  FONT_SIZE_RANGE,
  enableNotifications,
  getSettings,
  notificationsSupported,
  resetSettings,
  updateSettings,
  type ClockFormat,
  type Theme
} from './settings';

export interface SettingsContext {
  root: HTMLElement;
  gateway: Gateway;
  getUser(): PublicUser;
  serverUrl: string;
  onLogout(): void;
}

export interface SettingsHandle {
  /** Feed server events to the open dialog (profile saved, password changed…). */
  handleEvent(event: ServerEvent): void;
  close(): void;
}

type TabId = 'profile' | 'appearance' | 'notifications' | 'about';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'profile', label: 'My profile', icon: 'user' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'about', label: 'About', icon: 'info' }
];

export function openSettings(ctx: SettingsContext, onClose: () => void): SettingsHandle {
  const { root, gateway } = ctx;
  let tab: TabId = 'profile';
  let savingProfile = false;

  const nav = el('nav', { class: 'settings-nav', role: 'tablist', 'aria-label': 'Settings sections' });
  const title = el('h2', {});
  const content = el('div', { class: 'settings-content' });

  const close = openModal(
    root,
    'Settings',
    [
      el(
        'div',
        { class: 'settings' },
        nav,
        el(
          'div',
          { class: 'settings-body' },
          el(
            'header',
            { class: 'settings-header' },
            title,
            el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close settings', onclick: () => close() }, icon('close', 20))
          ),
          content
        )
      )
    ],
    { wide: true, bare: true, onClose }
  );

  function render(): void {
    nav.replaceChildren(
      ...TABS.map(({ id, label, icon: iconName }) =>
        el(
          'button',
          {
            class: `settings-tab${id === tab ? ' active' : ''}`,
            role: 'tab',
            'aria-selected': id === tab ? 'true' : 'false',
            onclick: () => {
              tab = id;
              render();
            }
          },
          icon(iconName, 18),
          el('span', {}, label)
        )
      )
    );
    title.textContent = TABS.find((t) => t.id === tab)?.label ?? '';
    const builders: Record<TabId, () => HTMLElement[]> = {
      profile: profileTab,
      appearance: appearanceTab,
      notifications: notificationsTab,
      about: aboutTab
    };
    content.replaceChildren(...builders[tab]());
  }

  // ---------------------------------------------------------------- profile

  function profileTab(): HTMLElement[] {
    const user = ctx.getUser();
    let color = user.color;

    const nameInput = el('input', { type: 'text', maxlength: LIMITS.displayNameMax, value: user.displayName });
    const bioInput = el('textarea', {
      class: 'field',
      rows: 4,
      maxlength: LIMITS.bioMax,
      placeholder: 'Tell people a little about yourself'
    });
    bioInput.value = user.bio;
    const counter = el('span', { class: 'muted counter' });
    const preview = el('div', { class: 'profile-preview' });
    const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Avatar colour' });
    const save = el('button', { class: 'btn primary', type: 'submit' }, 'Save changes');

    function refresh(): void {
      const name = nameInput.value.trim();
      const dirty = name !== user.displayName || bioInput.value.trim() !== user.bio || color !== user.color;
      preview.replaceChildren(
        avatar({ id: user.id, displayName: name || user.username, color }, 'xl'),
        el(
          'div',
          {},
          el('strong', { class: 'preview-name' }, name || user.username),
          el('div', { class: 'muted' }, `@${user.username}`)
        )
      );
      counter.textContent = `${bioInput.value.length}/${LIMITS.bioMax}`;
      swatches.replaceChildren(
        ...AVATAR_COLORS.map((value) => {
          const swatch = el('button', {
            type: 'button',
            class: `swatch${value === color ? ' selected' : ''}`,
            role: 'radio',
            'aria-checked': value === color ? 'true' : 'false',
            'aria-label': `Colour ${value}`,
            onclick: () => {
              color = value;
              refresh();
            }
          });
          swatch.style.background = value;
          return swatch;
        })
      );
      save.disabled = !dirty || !name;
    }
    nameInput.addEventListener('input', refresh);
    bioInput.addEventListener('input', refresh);

    const profileForm = el(
      'form',
      {
        onsubmit: (event: Event) => {
          event.preventDefault();
          savingProfile = true;
          gateway.send({
            type: 'update_profile',
            displayName: nameInput.value,
            bio: bioInput.value,
            color
          });
        }
      },
      preview,
      el('label', {}, 'Display name'),
      nameInput,
      el('label', {}, 'About me'),
      bioInput,
      counter,
      el('label', {}, 'Avatar colour'),
      swatches,
      el('div', { class: 'form-actions' }, save)
    );
    refresh();

    // Password
    const current = el('input', { type: 'password', autocomplete: 'current-password', maxlength: LIMITS.passwordMax });
    const next = el('input', { type: 'password', autocomplete: 'new-password', maxlength: LIMITS.passwordMax });
    const confirm = el('input', { type: 'password', autocomplete: 'new-password', maxlength: LIMITS.passwordMax });
    const passwordForm = el(
      'form',
      {
        onsubmit: (event: Event) => {
          event.preventDefault();
          if (next.value !== confirm.value) return toast(root, 'The new passwords do not match.');
          gateway.send({ type: 'change_password', currentPassword: current.value, newPassword: next.value });
        }
      },
      el('label', {}, 'Current password'),
      current,
      el('label', {}, 'New password'),
      next,
      el('label', {}, 'Confirm new password'),
      confirm,
      el('div', { class: 'form-actions' }, el('button', { class: 'btn secondary', type: 'submit' }, 'Change password'))
    );

    return [profileForm, el('h3', {}, 'Password'), passwordForm];
  }

  // ------------------------------------------------------------- appearance

  function appearanceTab(): HTMLElement[] {
    const settings = getSettings();

    const fontValue = el('span', { class: 'muted' }, `${settings.fontSize}px`);
    const slider = el('input', {
      type: 'range',
      min: FONT_SIZE_RANGE.min,
      max: FONT_SIZE_RANGE.max,
      step: 1,
      value: settings.fontSize,
      'aria-label': 'Font size',
      oninput: () => {
        updateSettings({ fontSize: Number(slider.value) });
        fontValue.textContent = `${slider.value}px`;
      }
    });

    return [
      field(
        'Theme',
        segmented<Theme>(
          [
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' }
          ],
          settings.theme,
          (theme) => updateSettings({ theme })
        )
      ),
      field('Font size', el('div', { class: 'slider-row' }, slider, fontValue)),
      field(
        'Message density',
        segmented<'cozy' | 'compact'>(
          [
            { value: 'cozy', label: 'Cozy' },
            { value: 'compact', label: 'Compact' }
          ],
          settings.compact ? 'compact' : 'cozy',
          (value) => updateSettings({ compact: value === 'compact' }),
        ),
        'Compact hides avatars and tightens the spacing.'
      ),
      field(
        'Time format',
        segmented<ClockFormat>(
          [
            { value: 'auto', label: 'Automatic' },
            { value: '12', label: '12-hour' },
            { value: '24', label: '24-hour' }
          ],
          settings.clock,
          (clock) => updateSettings({ clock })
        )
      )
    ];
  }

  // ---------------------------------------------------------- notifications

  function notificationsTab(): HTMLElement[] {
    const supported = notificationsSupported();
    const toggle = el('input', {
      type: 'checkbox',
      class: 'switch',
      role: 'switch',
      'aria-label': 'Message notifications',
      disabled: !supported
    });
    toggle.checked = getSettings().notifications && supported;
    toggle.addEventListener('change', () => {
      void (async () => {
        const allowed = toggle.checked ? await enableNotifications() : false;
        if (toggle.checked && !allowed) {
          toggle.checked = false;
          toast(root, 'Notifications are blocked. Allow them in your system settings.');
        }
        updateSettings({ notifications: toggle.checked });
      })();
    });
    return [
      field(
        'Message notifications',
        toggle,
        supported
          ? 'Show a notification for new messages while the app is in the background.'
          : 'Notifications are not available on this device.'
      )
    ];
  }

  // ------------------------------------------------------------------ about

  function aboutTab(): HTMLElement[] {
    const user = ctx.getUser();
    const version = el('dd', {}, '…');
    void (window.slack?.getVersion() ?? Promise.resolve('mobile / web')).then((v) => {
      version.textContent = v;
    });
    const platform = platformKind();
    return [
      el(
        'dl',
        { class: 'about' },
        el('dt', {}, 'App'),
        el('dd', {}, 'Slack'),
        el('dt', {}, 'Version'),
        version,
        el('dt', {}, 'Platform'),
        el('dd', {}, platform === 'desktop' ? `Desktop (${window.slack?.platform})` : platform),
        el('dt', {}, 'Signed in as'),
        el('dd', {}, `@${user.username}`),
        el('dt', {}, 'Server'),
        el('dd', {}, ctx.serverUrl)
      ),
      el(
        'div',
        { class: 'form-actions spread' },
        el(
          'button',
          {
            class: 'btn secondary',
            onclick: () => {
              resetSettings();
              render();
              toast(root, 'App settings were reset.');
            }
          },
          'Reset app settings'
        ),
        el(
          'button',
          {
            class: 'btn danger',
            onclick: () => {
              close();
              ctx.onLogout();
            }
          },
          icon('logout', 16),
          'Log out'
        )
      )
    ];
  }

  render();

  return {
    close,
    handleEvent(event) {
      if (event.type === 'user_update' && event.user.id === ctx.getUser().id) {
        if (savingProfile) toast(root, 'Profile saved.');
        savingProfile = false;
        if (tab === 'profile') render();
      } else if (event.type === 'password_changed') {
        toast(root, 'Password changed. Your other devices were signed out.');
        if (tab === 'profile') render();
      } else if (event.type === 'error') {
        savingProfile = false;
      }
    }
  };
}

// ------------------------------------------------------------------ widgets

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el(
    'div',
    { class: 'setting' },
    el('div', { class: 'setting-text' }, el('strong', {}, label), hint ? el('p', { class: 'muted' }, hint) : null),
    control
  );
}

function segmented<T extends string>(
  options: { value: T; label: string }[],
  selected: T,
  onChange: (value: T) => void
): HTMLElement {
  const group = el('div', { class: 'segmented', role: 'group' });
  const paint = (value: T) =>
    group.replaceChildren(
      ...options.map((option) =>
        el(
          'button',
          {
            type: 'button',
            class: option.value === value ? 'selected' : '',
            'aria-pressed': option.value === value ? 'true' : 'false',
            onclick: () => {
              paint(option.value);
              onChange(option.value);
            }
          },
          option.label
        )
      )
    );
  paint(selected);
  return group;
}

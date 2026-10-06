import { el } from './dom';

let closeCurrent: (() => void) | null = null;

export interface ModalOptions {
  /** Larger dialog (used by settings). Full-screen on phones either way. */
  wide?: boolean;
  /** Hide the default title bar; the content provides its own header. */
  bare?: boolean;
  onClose?: () => void;
}

/** Opens a dialog on top of `root`. Only one dialog is open at a time. Returns a function that closes it. */
export function openModal(
  root: HTMLElement,
  title: string,
  content: Node[],
  options: ModalOptions = {}
): () => void {
  closeCurrent?.();

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const overlay = el(
    'div',
    { class: 'modal-overlay', onmousedown: (event: MouseEvent) => event.target === overlay && close() },
    el(
      'div',
      { class: `modal${options.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      options.bare ? null : el('h2', {}, title),
      ...content
    )
  );

  function close(): void {
    if (closeCurrent !== close) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    closeCurrent = null;
    options.onClose?.();
  }

  document.addEventListener('keydown', onKey);
  closeCurrent = close;
  root.append(overlay);
  overlay.querySelector('input')?.focus();
  return close;
}

/** Closes the open dialog, if any. Returns whether there was one (used for the Android back button). */
export function closeTopModal(): boolean {
  if (!closeCurrent) return false;
  closeCurrent();
  return true;
}

export function toast(root: HTMLElement, text: string): void {
  const node = el('div', { class: 'toast', role: 'status' }, text);
  root.append(node);
  window.setTimeout(() => node.remove(), 4000);
}

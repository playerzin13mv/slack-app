import type { PublicUser } from '../shared/protocol';
import { el, initials } from './dom';

export type AvatarSize = 'sm' | 'md' | 'xl';

/** Round avatar showing the user's initials on their chosen colour. */
export function avatar(
  user: Pick<PublicUser, 'id' | 'displayName' | 'color'>,
  size: AvatarSize,
  online?: Set<string>
): HTMLElement {
  const node = el('div', { class: `avatar ${size}`, 'aria-hidden': 'true' }, initials(user.displayName));
  node.style.background = user.color;
  if (online?.has(user.id)) node.classList.add('is-online');
  return node;
}

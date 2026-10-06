import type { PublicUser } from '../shared/protocol';
import { avatar } from './avatar';
import { el } from './dom';
import { openModal } from './modal';

/** Small dialog showing another user's profile. */
export function openProfileCard(root: HTMLElement, user: PublicUser, online: boolean): void {
  openModal(root, user.displayName, [
    el(
      'div',
      { class: 'profile-card' },
      avatar(user, 'xl', online ? new Set([user.id]) : undefined),
      el('div', {}, el('strong', { class: 'preview-name' }, user.displayName), el('div', { class: 'muted' }, `@${user.username}`)),
      el('div', { class: 'muted status' }, online ? 'Online' : 'Offline'),
      user.bio ? el('p', { class: 'bio' }, user.bio) : el('p', { class: 'muted' }, 'This user has not written anything yet.')
    )
  ]);
}

/**
 * Wire protocol shared by the desktop client and the server.
 * Every WebSocket frame is a single JSON-encoded event with a `type` field.
 */

/** Avatar colours a user can pick from. */
export const AVATAR_COLORS = [
  '#5865f2',
  '#8b5cf6',
  '#d946ef',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#64748b'
] as const;

export interface PublicUser {
  id: string;
  /** Unique login name. */
  username: string;
  /** Name shown in the UI; defaults to the username. */
  displayName: string;
  bio: string;
  /** One of AVATAR_COLORS. */
  color: string;
}

export interface ProfileUpdate {
  displayName: string;
  bio: string;
  color: string;
}

export interface ChannelDTO {
  id: string;
  guildId: string;
  name: string;
}

/** A "guild" is a community (what Discord calls a server) that owns channels and members. */
export interface GuildDTO {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  channels: ChannelDTO[];
  members: PublicUser[];
}

export interface MessageDTO {
  id: string;
  channelId: string;
  author: PublicUser;
  content: string;
  timestamp: number;
}

export const LIMITS = {
  usernameMin: 2,
  usernameMax: 32,
  passwordMin: 8,
  passwordMax: 128,
  displayNameMax: 32,
  bioMax: 190,
  guildNameMax: 50,
  channelNameMax: 32,
  messageMax: 2000
} as const;

export type ClientEvent =
  | { type: 'register'; username: string; password: string }
  | { type: 'login'; username: string; password: string }
  | { type: 'resume'; token: string }
  | { type: 'logout' }
  | ({ type: 'update_profile' } & ProfileUpdate)
  | { type: 'change_password'; currentPassword: string; newPassword: string }
  | { type: 'create_guild'; name: string }
  | { type: 'join_guild'; inviteCode: string }
  | { type: 'create_channel'; guildId: string; name: string }
  | { type: 'fetch_history'; channelId: string }
  | { type: 'send_message'; channelId: string; content: string }
  | { type: 'typing'; channelId: string };

export type ServerEvent =
  | { type: 'auth_ok'; token: string; user: PublicUser }
  | { type: 'ready'; guilds: GuildDTO[]; online: string[] }
  | { type: 'guild_create'; guild: GuildDTO; online: string[] }
  | { type: 'guild_update'; guild: GuildDTO }
  | { type: 'history'; channelId: string; messages: MessageDTO[] }
  | { type: 'message_create'; message: MessageDTO }
  | { type: 'presence_update'; userId: string; online: boolean }
  | { type: 'user_update'; user: PublicUser }
  | { type: 'password_changed' }
  | { type: 'typing'; channelId: string; user: PublicUser }
  | { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'bad_request'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'username_taken'
  | 'not_authenticated'
  | 'already_authenticated'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited';

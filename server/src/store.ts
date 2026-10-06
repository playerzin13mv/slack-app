import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AVATAR_COLORS,
  LIMITS,
  type ChannelDTO,
  type ErrorCode,
  type GuildDTO,
  type MessageDTO,
  type ProfileUpdate,
  type PublicUser
} from '../../src/shared/protocol';

interface UserRecord {
  id: string;
  username: string;
  salt: string;
  hash: string;
  createdAt: number;
  // Optional so data files written before profiles existed still load.
  displayName?: string;
  bio?: string;
  color?: string;
}

interface GuildRecord {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  memberIds: string[];
  channels: ChannelDTO[];
}

interface MessageRecord {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  timestamp: number;
}

interface Snapshot {
  users: UserRecord[];
  guilds: GuildRecord[];
  messages: MessageRecord[];
  sessions: Record<string, string>;
}

export class StoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
  }
}

export const PUBLIC_GUILD_ID = 'public-square';
const SYSTEM_USER_ID = 'system';
const HISTORY_PAGE = 50;
const MAX_MESSAGES_PER_CHANNEL = 1000;
const MAX_CHANNELS_PER_GUILD = 50;
const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const CHANNEL_RE = /^[a-z0-9_-]+$/;

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

/** In-memory data store with debounced JSON persistence. */
export class Store {
  private users = new Map<string, UserRecord>();
  private userIdsByName = new Map<string, string>();
  private guilds = new Map<string, GuildRecord>();
  private messages = new Map<string, MessageRecord[]>();
  private sessions = new Map<string, string>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string | null) {
    this.load();
    this.ensurePublicGuild();
  }

  // ---------------------------------------------------------------- users

  register(username: string, password: string): PublicUser {
    username = username.trim();
    if (
      username.length < LIMITS.usernameMin ||
      username.length > LIMITS.usernameMax ||
      !USERNAME_RE.test(username)
    ) {
      throw new StoreError(
        'bad_request',
        `Username must be ${LIMITS.usernameMin}-${LIMITS.usernameMax} characters: letters, numbers, "_", "." or "-".`
      );
    }
    this.validatePassword(password);
    if (this.userIdsByName.has(username.toLowerCase())) {
      throw new StoreError('username_taken', 'That username is already taken.');
    }

    const salt = randomBytes(16).toString('hex');
    const user: UserRecord = {
      id: randomUUID(),
      username,
      salt,
      hash: hashPassword(password, salt),
      createdAt: Date.now(),
      displayName: username,
      bio: '',
      color: AVATAR_COLORS[randomBytes(1)[0]! % AVATAR_COLORS.length]
    };
    this.users.set(user.id, user);
    this.userIdsByName.set(username.toLowerCase(), user.id);
    this.guilds.get(PUBLIC_GUILD_ID)?.memberIds.push(user.id);
    this.scheduleSave();
    return this.publicUser(user.id);
  }

  login(username: string, password: string): PublicUser {
    const id = this.userIdsByName.get(username.trim().toLowerCase());
    const user = id ? this.users.get(id) : undefined;
    if (!user || !this.passwordMatches(user, password)) {
      throw new StoreError('invalid_credentials', 'Invalid username or password.');
    }
    return this.publicUser(user.id);
  }

  updateProfile(userId: string, update: ProfileUpdate): PublicUser {
    const user = this.requireUser(userId);
    const displayName = update.displayName.trim();
    const bio = update.bio.trim();
    if (!displayName || displayName.length > LIMITS.displayNameMax || /[\u0000-\u001f\u007f]/.test(displayName)) {
      throw new StoreError('bad_request', `Display name must be 1-${LIMITS.displayNameMax} characters.`);
    }
    if (bio.length > LIMITS.bioMax) {
      throw new StoreError('bad_request', `About me can be at most ${LIMITS.bioMax} characters.`);
    }
    if (!(AVATAR_COLORS as readonly string[]).includes(update.color)) {
      throw new StoreError('bad_request', 'Unknown avatar colour.');
    }
    user.displayName = displayName;
    user.bio = bio;
    user.color = update.color;
    this.scheduleSave();
    return this.publicUser(userId);
  }

  /** Changes the password and signs out every session except `keepToken`. */
  changePassword(userId: string, currentPassword: string, newPassword: string, keepToken: string | null): void {
    const user = this.requireUser(userId);
    if (!this.passwordMatches(user, currentPassword)) {
      throw new StoreError('invalid_credentials', 'Your current password is incorrect.');
    }
    this.validatePassword(newPassword);
    user.salt = randomBytes(16).toString('hex');
    user.hash = hashPassword(newPassword, user.salt);
    for (const [token, id] of this.sessions) {
      if (id === userId && token !== keepToken) this.sessions.delete(token);
    }
    this.scheduleSave();
  }

  private passwordMatches(user: UserRecord | undefined, password: string): boolean {
    // Always run scrypt so response time doesn't reveal whether the user exists.
    const salt = user?.salt ?? '00'.repeat(16);
    const candidate = Buffer.from(hashPassword(password, salt), 'hex');
    const expected = Buffer.from(user?.hash ?? '00'.repeat(64), 'hex');
    return timingSafeEqual(candidate, expected) && user !== undefined;
  }

  private validatePassword(password: string): void {
    if (password.length < LIMITS.passwordMin || password.length > LIMITS.passwordMax) {
      throw new StoreError(
        'bad_request',
        `Password must be ${LIMITS.passwordMin}-${LIMITS.passwordMax} characters.`
      );
    }
  }

  private requireUser(id: string): UserRecord {
    const user = this.users.get(id);
    if (!user) throw new StoreError('not_found', 'User not found.');
    return user;
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, userId);
    this.scheduleSave();
    return token;
  }

  resume(token: string): PublicUser {
    const userId = this.sessions.get(token);
    if (!userId || !this.users.has(userId)) {
      throw new StoreError('invalid_token', 'Your session has expired. Please log in again.');
    }
    return this.publicUser(userId);
  }

  deleteSession(token: string): void {
    if (this.sessions.delete(token)) this.scheduleSave();
  }

  publicUser(id: string): PublicUser {
    const user = this.requireUser(id);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      bio: user.bio ?? '',
      color: user.color ?? AVATAR_COLORS[0]
    };
  }

  // --------------------------------------------------------------- guilds

  guildsFor(userId: string): GuildDTO[] {
    return [...this.guilds.values()]
      .filter((g) => g.memberIds.includes(userId))
      .map((g) => this.toGuildDTO(g));
  }

  getGuild(guildId: string): GuildDTO {
    return this.toGuildDTO(this.requireGuild(guildId));
  }

  createGuild(userId: string, name: string): GuildDTO {
    name = name.trim();
    if (!name || name.length > LIMITS.guildNameMax) {
      throw new StoreError('bad_request', `Community name must be 1-${LIMITS.guildNameMax} characters.`);
    }
    const id = randomUUID();
    const guild: GuildRecord = {
      id,
      name,
      ownerId: userId,
      inviteCode: randomBytes(4).toString('hex'),
      memberIds: [userId],
      channels: [{ id: randomUUID(), guildId: id, name: 'general' }]
    };
    this.guilds.set(id, guild);
    this.scheduleSave();
    return this.toGuildDTO(guild);
  }

  /** Returns the guild and whether the user was newly added. */
  joinGuild(userId: string, inviteCode: string): { guild: GuildDTO; joined: boolean } {
    const code = inviteCode.trim().toLowerCase();
    const guild = [...this.guilds.values()].find((g) => g.inviteCode === code);
    if (!guild) throw new StoreError('not_found', 'That invite code is not valid.');
    if (guild.memberIds.includes(userId)) return { guild: this.toGuildDTO(guild), joined: false };
    guild.memberIds.push(userId);
    this.scheduleSave();
    return { guild: this.toGuildDTO(guild), joined: true };
  }

  createChannel(userId: string, guildId: string, rawName: string): GuildDTO {
    const guild = this.requireGuild(guildId);
    if (guild.ownerId !== userId) {
      throw new StoreError('forbidden', 'Only the owner can create channels.');
    }
    if (guild.channels.length >= MAX_CHANNELS_PER_GUILD) {
      throw new StoreError('bad_request', 'This community has reached the channel limit.');
    }
    const name = rawName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name || name.length > LIMITS.channelNameMax || !CHANNEL_RE.test(name)) {
      throw new StoreError(
        'bad_request',
        `Channel name must be 1-${LIMITS.channelNameMax} characters: letters, numbers, "-" or "_".`
      );
    }
    if (guild.channels.some((c) => c.name === name)) {
      throw new StoreError('bad_request', 'A channel with that name already exists.');
    }
    guild.channels.push({ id: randomUUID(), guildId, name });
    this.scheduleSave();
    return this.toGuildDTO(guild);
  }

  memberIdsOf(guildId: string): string[] {
    return this.requireGuild(guildId).memberIds.filter((id) => this.users.has(id));
  }

  /** Every user who shares at least one guild with `userId` (including themself). */
  audience(userId: string): Set<string> {
    const ids = new Set<string>([userId]);
    for (const guild of this.guilds.values()) {
      if (guild.memberIds.includes(userId)) guild.memberIds.forEach((id) => ids.add(id));
    }
    return ids;
  }

  // ------------------------------------------------------------- messages

  /** Resolves a channel the user is allowed to see, or throws. */
  accessChannel(userId: string, channelId: string): { guildId: string; channel: ChannelDTO } {
    for (const guild of this.guilds.values()) {
      const channel = guild.channels.find((c) => c.id === channelId);
      if (channel) {
        if (!guild.memberIds.includes(userId)) {
          throw new StoreError('forbidden', 'You are not a member of this community.');
        }
        return { guildId: guild.id, channel };
      }
    }
    throw new StoreError('not_found', 'Channel not found.');
  }

  addMessage(userId: string, channelId: string, content: string): MessageDTO {
    this.accessChannel(userId, channelId);
    content = content.trim();
    if (!content || content.length > LIMITS.messageMax) {
      throw new StoreError('bad_request', `Messages must be 1-${LIMITS.messageMax} characters.`);
    }
    const record: MessageRecord = {
      id: randomUUID(),
      channelId,
      authorId: userId,
      content,
      timestamp: Date.now()
    };
    const list = this.messages.get(channelId) ?? [];
    list.push(record);
    if (list.length > MAX_MESSAGES_PER_CHANNEL) list.splice(0, list.length - MAX_MESSAGES_PER_CHANNEL);
    this.messages.set(channelId, list);
    this.scheduleSave();
    return this.toMessageDTO(record);
  }

  history(userId: string, channelId: string): MessageDTO[] {
    this.accessChannel(userId, channelId);
    return (this.messages.get(channelId) ?? []).slice(-HISTORY_PAGE).map((m) => this.toMessageDTO(m));
  }

  // ---------------------------------------------------------- persistence

  /** Writes pending changes to disk immediately. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.file) return;
    const snapshot: Snapshot = {
      users: [...this.users.values()],
      guilds: [...this.guilds.values()],
      messages: [...this.messages.values()].flat(),
      sessions: Object.fromEntries(this.sessions)
    };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, this.file);
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.flush();
      } catch (err) {
        console.error('[store] failed to save data:', err);
      }
    }, 500);
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    // A corrupt file throws on purpose: crashing is safer than overwriting it with an empty store.
    const snapshot = JSON.parse(readFileSync(this.file, 'utf8')) as Snapshot;
    for (const user of snapshot.users) {
      this.users.set(user.id, user);
      this.userIdsByName.set(user.username.toLowerCase(), user.id);
    }
    for (const guild of snapshot.guilds) this.guilds.set(guild.id, guild);
    for (const message of snapshot.messages) {
      const list = this.messages.get(message.channelId) ?? [];
      list.push(message);
      this.messages.set(message.channelId, list);
    }
    for (const [token, userId] of Object.entries(snapshot.sessions)) this.sessions.set(token, userId);
  }

  private ensurePublicGuild(): void {
    if (this.guilds.has(PUBLIC_GUILD_ID)) return;
    this.guilds.set(PUBLIC_GUILD_ID, {
      id: PUBLIC_GUILD_ID,
      name: 'Public Square',
      ownerId: SYSTEM_USER_ID,
      inviteCode: 'public',
      memberIds: [...this.users.keys()],
      channels: [
        { id: 'public-general', guildId: PUBLIC_GUILD_ID, name: 'general' },
        { id: 'public-random', guildId: PUBLIC_GUILD_ID, name: 'random' }
      ]
    });
    this.scheduleSave();
  }

  // -------------------------------------------------------------- helpers

  private requireGuild(guildId: string): GuildRecord {
    const guild = this.guilds.get(guildId);
    if (!guild) throw new StoreError('not_found', 'Community not found.');
    return guild;
  }

  private toGuildDTO(guild: GuildRecord): GuildDTO {
    return {
      id: guild.id,
      name: guild.name,
      ownerId: guild.ownerId,
      inviteCode: guild.inviteCode,
      channels: guild.channels,
      members: guild.memberIds.filter((id) => this.users.has(id)).map((id) => this.publicUser(id))
    };
  }

  private toMessageDTO(record: MessageRecord): MessageDTO {
    return {
      id: record.id,
      channelId: record.channelId,
      author: this.publicUser(record.authorId),
      content: record.content,
      timestamp: record.timestamp
    };
  }
}

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientEvent, ServerEvent } from '../../src/shared/protocol';
import { Store, StoreError } from './store';

const PORT = Number(process.env.PORT ?? 3001);
const DATA_FILE = process.env.DATA_FILE === '' ? null : (process.env.DATA_FILE ?? 'data/slack.json');

const RATE_WINDOW_MS = 10_000;
const RATE_MAX_EVENTS = 40;
const HEARTBEAT_MS = 30_000;

interface Client {
  ws: WebSocket;
  userId: string | null;
  token: string | null;
  alive: boolean;
  recent: number[];
}

const store = new Store(DATA_FILE);
/** Every open socket, authenticated or not. */
const sockets = new Map<WebSocket, Client>();
/** Authenticated clients grouped by user (one user can have several windows). */
const connections = new Map<string, Set<Client>>();

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', online: connections.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });

// ------------------------------------------------------------------ sending

function send(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

function sendToUser(userId: string, event: ServerEvent): void {
  connections.get(userId)?.forEach((c) => send(c.ws, event));
}

function sendToUsers(userIds: Iterable<string>, event: ServerEvent, exceptUserId?: string): void {
  for (const id of userIds) {
    if (id !== exceptUserId) sendToUser(id, event);
  }
}

function onlineAmong(userId: string): string[] {
  return [...store.audience(userId)].filter((id) => connections.has(id));
}

// --------------------------------------------------------------------- auth

function authenticate(client: Client, userId: string, token: string): void {
  client.userId = userId;
  client.token = token;

  let set = connections.get(userId);
  if (!set) connections.set(userId, (set = new Set()));
  const firstConnection = set.size === 0;
  set.add(client);

  send(client.ws, { type: 'auth_ok', token, user: store.publicUser(userId) });
  send(client.ws, { type: 'ready', guilds: store.guildsFor(userId), online: onlineAmong(userId) });
  if (firstConnection) {
    sendToUsers(store.audience(userId), { type: 'presence_update', userId, online: true }, userId);
  }
}

function disconnect(client: Client): void {
  const { userId } = client;
  if (!userId) return;
  client.userId = null;
  const set = connections.get(userId);
  set?.delete(client);
  if (set && set.size === 0) {
    connections.delete(userId);
    sendToUsers(store.audience(userId), { type: 'presence_update', userId, online: false });
  }
}

// ----------------------------------------------------------------- handlers

function handle(client: Client, event: ClientEvent): void {
  switch (event.type) {
    case 'register': {
      requireAnonymous(client);
      const user = store.register(str(event.username), str(event.password));
      authenticate(client, user.id, store.createSession(user.id));
      return;
    }
    case 'login': {
      requireAnonymous(client);
      const user = store.login(str(event.username), str(event.password));
      authenticate(client, user.id, store.createSession(user.id));
      return;
    }
    case 'resume': {
      requireAnonymous(client);
      const token = str(event.token);
      authenticate(client, store.resume(token).id, token);
      return;
    }
  }

  const userId = client.userId;
  if (!userId) throw new StoreError('not_authenticated', 'Please log in first.');

  switch (event.type) {
    case 'logout': {
      if (client.token) store.deleteSession(client.token);
      client.token = null;
      disconnect(client);
      return;
    }
    case 'update_profile': {
      const user = store.updateProfile(userId, {
        displayName: str(event.displayName),
        bio: str(event.bio),
        color: str(event.color)
      });
      sendToUsers(store.audience(userId), { type: 'user_update', user });
      return;
    }
    case 'change_password': {
      store.changePassword(userId, str(event.currentPassword), str(event.newPassword), client.token);
      send(client.ws, { type: 'password_changed' });
      return;
    }
    case 'create_guild': {
      const guild = store.createGuild(userId, str(event.name));
      send(client.ws, { type: 'guild_create', guild, online: onlineAmong(userId) });
      return;
    }
    case 'join_guild': {
      const { guild, joined } = store.joinGuild(userId, str(event.inviteCode));
      send(client.ws, { type: 'guild_create', guild, online: onlineAmong(userId) });
      if (joined) {
        const others = store.memberIdsOf(guild.id);
        sendToUsers(others, { type: 'guild_update', guild }, userId);
        sendToUsers(others, { type: 'presence_update', userId, online: true }, userId);
      }
      return;
    }
    case 'create_channel': {
      const guild = store.createChannel(userId, str(event.guildId), str(event.name));
      sendToUsers(store.memberIdsOf(guild.id), { type: 'guild_update', guild });
      return;
    }
    case 'fetch_history': {
      const channelId = str(event.channelId);
      send(client.ws, { type: 'history', channelId, messages: store.history(userId, channelId) });
      return;
    }
    case 'send_message': {
      const channelId = str(event.channelId);
      const message = store.addMessage(userId, channelId, str(event.content));
      const { guildId } = store.accessChannel(userId, channelId);
      sendToUsers(store.memberIdsOf(guildId), { type: 'message_create', message });
      return;
    }
    case 'typing': {
      const channelId = str(event.channelId);
      const { guildId } = store.accessChannel(userId, channelId);
      sendToUsers(
        store.memberIdsOf(guildId),
        { type: 'typing', channelId, user: store.publicUser(userId) },
        userId
      );
      return;
    }
    default:
      throw new StoreError('bad_request', 'Unknown event.');
  }
}

function requireAnonymous(client: Client): void {
  if (client.userId) throw new StoreError('already_authenticated', 'You are already logged in.');
}

/** Coerces untrusted JSON fields to strings. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function rateLimited(client: Client): boolean {
  const now = Date.now();
  client.recent = client.recent.filter((t) => now - t < RATE_WINDOW_MS);
  client.recent.push(now);
  return client.recent.length > RATE_MAX_EVENTS;
}

// -------------------------------------------------------------- connections

wss.on('connection', (ws) => {
  const client: Client = { ws, userId: null, token: null, alive: true, recent: [] };
  sockets.set(ws, client);

  ws.on('pong', () => {
    client.alive = true;
  });

  ws.on('message', (data) => {
    try {
      if (rateLimited(client)) throw new StoreError('rate_limited', 'You are sending too many requests.');
      const event: unknown = JSON.parse(data.toString());
      if (typeof event !== 'object' || event === null || typeof (event as ClientEvent).type !== 'string') {
        throw new StoreError('bad_request', 'Malformed event.');
      }
      handle(client, event as ClientEvent);
    } catch (err) {
      if (err instanceof StoreError) {
        send(ws, { type: 'error', code: err.code, message: err.message });
      } else if (err instanceof SyntaxError) {
        send(ws, { type: 'error', code: 'bad_request', message: 'Invalid JSON.' });
      } else {
        console.error('[server] unexpected error:', err);
        send(ws, { type: 'error', code: 'bad_request', message: 'Something went wrong.' });
      }
    }
  });

  ws.on('close', () => {
    sockets.delete(ws);
    disconnect(client);
  });
  ws.on('error', () => ws.terminate());
});

const heartbeat = setInterval(() => {
  for (const client of sockets.values()) {
    if (!client.alive) {
      client.ws.terminate();
      continue;
    }
    client.alive = false;
    client.ws.ping();
  }
}, HEARTBEAT_MS);

// ----------------------------------------------------------------- lifecycle

http.listen(PORT, () => {
  console.log(`[server] Slack server listening on ws://localhost:${PORT}`);
  console.log(`[server] data file: ${DATA_FILE ?? '(in-memory only)'}`);
});

function shutdown(): void {
  clearInterval(heartbeat);
  wss.close();
  store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

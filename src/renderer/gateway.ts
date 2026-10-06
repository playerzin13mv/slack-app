import type { ClientEvent, ServerEvent } from '../shared/protocol';

export type GatewayStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** WebSocket wrapper with automatic reconnection (exponential backoff). */
export class Gateway {
  onEvent: (event: ServerEvent) => void = () => {};
  onStatus: (status: GatewayStatus) => void = () => {};

  private ws: WebSocket | null = null;
  private url = '';
  private wantOpen = false;
  private attempt = 0;
  private retryTimer: number | undefined;

  /** Resolves once connected; rejects if the first connection attempt fails. */
  connect(url: string): Promise<void> {
    this.close();
    this.url = url;
    this.wantOpen = true;
    this.attempt = 0;
    return new Promise((resolve, reject) => this.open({ resolve, reject }));
  }

  send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  close(): void {
    this.wantOpen = false;
    window.clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.onStatus('closed');
  }

  private open(initial?: { resolve: () => void; reject: (error: Error) => void }): void {
    let pending = initial;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.wantOpen = false;
      pending?.reject(new Error('Invalid server address.'));
      return;
    }
    this.ws = ws;
    this.onStatus(pending ? 'connecting' : 'reconnecting');

    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus('open');
      pending?.resolve();
      pending = undefined;
    };

    ws.onmessage = (message) => {
      try {
        this.onEvent(JSON.parse(String(message.data)) as ServerEvent);
      } catch (error) {
        console.error('Failed to handle server event', error);
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // replaced or closed on purpose
      this.ws = null;
      if (pending) {
        this.wantOpen = false;
        this.onStatus('closed');
        pending.reject(new Error('Could not connect to the server.'));
        return;
      }
      if (!this.wantOpen) return;
      this.onStatus('reconnecting');
      const delay = Math.min(1000 * 2 ** this.attempt++, 15_000);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
  }
}

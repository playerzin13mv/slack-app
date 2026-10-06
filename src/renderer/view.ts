import type { ServerEvent } from '../shared/protocol';
import type { GatewayStatus } from './gateway';

/** A top-level screen that owns the contents of the app root. */
export interface View {
  handleEvent?(event: ServerEvent): void;
  handleStatus?(status: GatewayStatus): void;
  /** Handles the Android back button. Return true if something was closed. */
  handleBack?(): boolean;
  destroy(): void;
}

declare global {
  interface Window {
    /** Exposed by src/preload/preload.ts; absent on mobile and in a plain browser. */
    slack?: {
      platform: string;
      getVersion(): Promise<string>;
    };
  }
}

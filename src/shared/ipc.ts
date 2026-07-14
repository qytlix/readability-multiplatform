export const IPC_CHANNELS = {
  systemPing: 'system:ping',
} as const;

export type PingResponse = {
  ok: true;
  message: 'pong';
};

export interface ShaleAPI {
  system: {
    ping: () => Promise<PingResponse>;
  };
}

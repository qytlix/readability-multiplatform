export interface ExternalOpenRequest {
  url: string;
  baseUrl?: string;
}

export const EXTERNAL_IPC_CHANNELS = {
  open: 'external:open',
} as const;

import type { IPCResult, ShaleError } from '../../shared/contracts/feed.ipc';
import type { ExternalOpenRequest } from '../../shared/contracts/external.ipc';
import { resolveExternalLink } from '../../shared/external-links';

export type OpenExternal = (url: string) => Promise<void>;

const failure = (code: string, message: string, retryable: boolean): IPCResult<void> => ({
  ok: false,
  error: { code, message, retryable } satisfies ShaleError,
});

/** Opens only fully resolved HTTP(S) article links in the operating system browser. */
export class ExternalLinkService {
  constructor(private readonly openExternal: OpenExternal) {}

  async open(request: ExternalOpenRequest): Promise<IPCResult<void>> {
    const resolution = resolveExternalLink(request.url, request.baseUrl);

    if (resolution.kind !== 'external') {
      return failure(
        'EXTERNAL_URL_BLOCKED',
        'This link cannot be opened.',
        false,
      );
    }

    try {
      await this.openExternal(resolution.url);
      return { ok: true, data: undefined };
    } catch {
      return failure(
        'EXTERNAL_OPEN_FAILED',
        'Unable to open this link in your default browser.',
        true,
      );
    }
  }
}

// Web sibling: the page never removes a host — `page-host-removal-refusal.ts` says why. The
// native file's `removeHost` reaches `host-store.ts`'s device keychain; on the page that resolves
// to `host-store.web.ts`'s no-op instead, which used to report success for a host still paired.
import { PageHostRemovalUnavailableError } from './page-host-removal-refusal'

export function removeHostAndCloseClient(
  _hostId: string,
  _forgetHostClient: (hostId: string) => void
): Promise<void> {
  return Promise.reject(new PageHostRemovalUnavailableError())
}

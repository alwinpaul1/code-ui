import { clearStoredOrganization, readStoredOrganization, storeOrganization } from '../dictation/anthropic-auth-store'
import { fetchAnthropicCredential } from '../dictation/anthropic-credential-reader'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-pipeline'
import { keepHostImageFile } from './host-image-files'
import { AGENT_IMAGE_MAX_BYTES } from './host-image-size-cap'

/** The real world for the session-API path: the phone's sign-in, its cached
 *  organization, fetch, and the host pictures' cache files. Loaded with
 *  `import()` (loadDefaultCcrPipelineDeps), so the chat's controller does not
 *  pull the secure store in with it. */
export function defaultCcrPipelineDeps(): CcrPipelineDeps {
  return {
    fetch: ((url, init) => fetch(url, init)) as CcrFetch,
    readToken: async () => (await fetchAnthropicCredential())?.accessToken ?? null,
    org: { read: readStoredOrganization, write: storeOrganization, clear: clearStoredOrganization },
    keep: (key, dataUri) => keepHostImageFile(key, dataUri),
    maxBytes: AGENT_IMAGE_MAX_BYTES
  }
}

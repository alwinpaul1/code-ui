import { forgetAccountOrganization, rememberAccountProfile } from '../dictation/anthropic-auth-store'
import { fetchAccountCredentials } from '../dictation/anthropic-credential-reader'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-pipeline'
import { keepHostImageFile } from './host-image-files'
import { AGENT_IMAGE_MAX_BYTES } from './host-image-size-cap'

/** The real world for the session-API path: the phone's sign-ins (one per Claude account, each
 *  with its own organization), fetch, and the host pictures' cache files. Loaded with
 *  `import()` (loadDefaultCcrPipelineDeps), so the chat's controller does not
 *  pull the secure store in with it. */
export function defaultCcrPipelineDeps(): CcrPipelineDeps {
  return {
    fetch: ((url, init) => fetch(url, init)) as CcrFetch,
    accounts: {
      list: async (only) =>
        (await fetchAccountCredentials(only)).map((account) => ({
          id: account.id,
          label: account.label,
          accessToken: account.accessToken,
          organizationUuid: account.organizationUuid,
          error: account.error
        })),
      rememberProfile: async (id, profile) => {
        await rememberAccountProfile(id, profile)
        return profile.accountUuid
      },
      forgetOrganization: forgetAccountOrganization
    },
    keep: (key, dataUri) => keepHostImageFile(key, dataUri),
    maxBytes: AGENT_IMAGE_MAX_BYTES
  }
}

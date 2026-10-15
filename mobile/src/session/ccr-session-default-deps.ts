import { fetch as expoFetch } from 'expo/fetch'
import { forgetAccountOrganization, rememberAccountProfile } from '../dictation/anthropic-auth-store'
import { fetchAccountCredentials } from '../dictation/anthropic-credential-reader'
import { fetchCcrProfile, type CcrFetch } from './ccr-session-api'
import type { CcrStreamFetch } from './ccr-event-stream'
import type { CcrLinkAuth, CcrLinkDeps } from './ccr-session-link'
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

/** One read of an account's sign-in at a time, per account: two links of one account share it,
 *  and an account's refresh never waits on, or touches, another's. */
const authInFlight = new Map<string, Promise<CcrLinkAuth | null>>()

async function readAccountAuth(accountId: string): Promise<CcrLinkAuth | null> {
  const [account] = await fetchAccountCredentials(accountId)
  if (!account?.accessToken) {
    return null
  }
  if (account.organizationUuid) {
    return { token: account.accessToken, organizationUuid: account.organizationUuid }
  }
  const profile = await fetchCcrProfile(((url, init) => fetch(url, init)) as CcrFetch, account.accessToken)
  await rememberAccountProfile(accountId, profile).catch(() => undefined)
  return { token: account.accessToken, organizationUuid: profile.organizationUuid }
}

/** The real world for a session link (ccr-session-link.ts): the account's own sign-in, React
 *  Native's fetch for pages, `expo/fetch` for the stream (React Native's fetch does not stream a
 *  response body; Expo 57's does), and the host pictures' cache files. */
export function defaultCcrLinkDeps(): CcrLinkDeps {
  return {
    fetch: ((url, init) => fetch(url, init)) as CcrFetch,
    // expo/fetch's response body is a web ReadableStream, the shape CcrStreamFetch reads.
    streamFetch: ((url: string, init: Parameters<CcrStreamFetch>[1]) => expoFetch(url, init)) as unknown as CcrStreamFetch,
    auth: (accountId) => {
      let running = authInFlight.get(accountId)
      if (!running) {
        running = readAccountAuth(accountId).finally(() => authInFlight.delete(accountId))
        authInFlight.set(accountId, running)
      }
      return running
    },
    keep: (key, dataUri) => keepHostImageFile(key, dataUri) || null
  }
}

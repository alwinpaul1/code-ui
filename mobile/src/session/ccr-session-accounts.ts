import { fetchCcrProfile } from './ccr-session-api'
import { maskId, reasonOf, type CcrAccountEntry, type CcrPipelineDeps, type CcrStage } from './ccr-session-shared'

/** One account the sessions path may ask: a live token and the organization it acts for. */
export type CcrAuth = { accountId: string; label: string; token: string; organizationUuid: string }

export type CcrAccountFailure = { stage: Extract<CcrStage, 'sign-in' | 'org'>; accountId: string | null; detail: string }

type Report = (stage: CcrStage, ok: boolean, detail: string) => void

/** With one account a line reads as it always did; with several, each line names its account. */
export function accountPrefix(label: string, accountCount: number): string {
  return accountCount > 1 ? `${label}: ` : ''
}

/**
 * Every signed-in account's token and organization, each resolved on its own: an account whose
 * token is gone or whose profile is refused comes back in `failures`, with the words that say why,
 * and the others are still returned. Zero accounts is one failure and nothing to ask.
 */
export async function resolveCcrAuths(deps: CcrPipelineDeps, report: Report): Promise<{ auths: CcrAuth[]; failures: CcrAccountFailure[] }> {
  let entries: CcrAccountEntry[]
  try {
    entries = await deps.accounts.list()
  } catch (error) {
    return { auths: [], failures: [{ stage: 'sign-in', accountId: null, detail: `the sign-in could not be read: ${reasonOf(error)}` }] }
  }
  if (entries.length === 0) {
    return { auths: [], failures: [{ stage: 'sign-in', accountId: null, detail: 'not signed in to Anthropic on this phone (Voice settings → Sign in)' }] }
  }
  const auths: CcrAuth[] = []
  const failures: CcrAccountFailure[] = []
  for (const entry of entries) {
    const prefix = accountPrefix(entry.label, entries.length)
    if (!entry.accessToken) {
      failures.push({ stage: 'sign-in', accountId: entry.id, detail: `${prefix}${entry.error ?? 'no usable token'}` })
      continue
    }
    report('sign-in', true, `${prefix}signed in`)
    if (entry.organizationUuid) {
      report('org', true, `${prefix}organization ${maskId(entry.organizationUuid)} (cached)`)
      auths.push({ accountId: entry.id, label: entry.label, token: entry.accessToken, organizationUuid: entry.organizationUuid })
      continue
    }
    try {
      const profile = await fetchCcrProfile(deps.fetch, entry.accessToken)
      // An account signed in without a profile gets its uuid as its id once the profile is kept.
      const accountId = await deps.accounts.rememberProfile(entry.id, profile).catch((error: unknown) => {
        console.warn(`[ccr-images] the profile could not be kept: ${reasonOf(error)}`)
        return entry.id
      })
      report('org', true, `${prefix}organization ${maskId(profile.organizationUuid)} (from /api/oauth/profile)`)
      auths.push({ accountId, label: entry.label, token: entry.accessToken, organizationUuid: profile.organizationUuid })
    } catch (error) {
      failures.push({ stage: 'org', accountId: entry.id, detail: `${prefix}${reasonOf(error)}` })
    }
  }
  return { auths, failures }
}

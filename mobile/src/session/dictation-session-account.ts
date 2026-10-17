import { SIGN_IN_TO_DICTATE, type DictationAccountLookup } from '../dictation/dictation-account-lookup'
import { ccrAccountForConfigDir, ccrAccountForTab } from './ccr-session-cache'
import { runCcrImagePipeline, type CcrPipelineDeps } from './ccr-session-pipeline'
import type { ClaudeTabAccountScope } from './use-claude-tab-account'

/** How long a take waits for Anthropic to say which account holds its session. The match goes on
 *  past it and is kept for the tab, so the next tap finds it at once. */
export const DICTATION_ACCOUNT_LOOKUP_MS = 6000

const CANT_TELL = "Can't tell which Anthropic account this session belongs to"

/**
 * The Anthropic account a Claude tab's session belongs to, found when a take starts in a chat whose
 * account is not matched yet (the user, 2026-10-17: "it must exactly tell"). The same answer
 * useClaudeTabAccount reads, made on demand: a match already made for the tab, else its config
 * dir's account, else the session-to-account match the pictures and the model pill run
 * (runCcrImagePipeline, nothing to fetch), even with one account signed in, awaited for at most
 * DICTATION_ACCOUNT_LOOKUP_MS. Never another account: when every signed-in account answered and
 * none holds the session it says so, and when the question could not be answered it says why.
 */
export async function lookUpDictationSessionAccount(
  scope: ClaudeTabAccountScope,
  tab: { messageIds: readonly string[]; newestMessageAt: number | null },
  load: () => Promise<CcrPipelineDeps>,
  timeoutMs: number = DICTATION_ACCOUNT_LOOKUP_MS
): Promise<DictationAccountLookup> {
  const known = () =>
    ccrAccountForTab(scope.tabId, scope.epoch, scope.agentSessionId, scope.configDir) ??
    (scope.configDir ? ccrAccountForConfigDir(scope.configDir) : null)
  const before = known()
  if (before) {
    return { ok: true, accountId: before }
  }
  let deps: CcrPipelineDeps
  let signedIn: { id: string }[]
  try {
    deps = await load()
    signedIn = await deps.accounts.list()
  } catch (error) {
    return { ok: false, reason: `Can't read the phone's Anthropic sign-ins to find this session's account: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (signedIn.length === 0) {
    return { ok: false, reason: SIGN_IN_TO_DICTATE }
  }
  // One account signed in is asked too: the session may be an account's that is not on the phone
  // (the user, 2026-10-17: "it must exactly tell"). Only a match, kept or made now, decides.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), timeoutMs)
  })
  const run = runCcrImagePipeline(
    { ...scope, messageIds: tab.messageIds, newestMessageAt: tab.newestMessageAt, wanted: { toolUseIds: [], userMessageIds: [] } },
    deps
  )
  let result: Awaited<typeof run> | null
  try {
    result = await Promise.race([run, timedOut])
  } catch (error) {
    return { ok: false, reason: `${CANT_TELL}, so dictation won't use another one: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    clearTimeout(timer)
  }
  if (result === null) {
    return { ok: false, reason: `${CANT_TELL}: Anthropic didn't answer within ${timeoutMs / 1000} s. Try again in a moment.` }
  }
  const matched = known()
  if (matched) {
    return { ok: true, accountId: matched }
  }
  const failed = result.stages.filter((stage) => !stage.ok).map((stage) => stage.detail)
  const detail = failed.length > 0 ? failed.join('; ') : 'no account matched this tab'
  if (result.unowned) {
    return {
      ok: false,
      reason: `This session belongs to an Anthropic account that isn't signed in on the phone: none of the ${signedIn.length} signed in holds it (${detail}). Sign in to that account in Settings, Anthropic accounts, to dictate here.`
    }
  }
  return { ok: false, reason: `${CANT_TELL}, so dictation won't use another one: ${detail}` }
}

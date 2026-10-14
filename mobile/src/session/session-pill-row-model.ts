import type { PRState } from '../../../src/shared/github/pull-request-types'
import { summarizeProviderChecks } from '../../../src/shared/provider-check-summary'
import type { ClipboardWriter } from '../platform/clipboard'
import type { MobileCreatePrEligibilityState } from '../source-control/mobile-create-pr-action'
import type { PrSidebarState } from './mobile-pr-sidebar-state'

/**
 * What the session pills show, as the Claude Android app draws them above its composer
 * (com.anthropic.claude 1.261009.20). Pure, so the states and wording are tested without a renderer.
 *
 * The app keeps one state per session branch (`yyf`, `xyf`, `zyf`):
 *   - a pull request exists (`yyf`: url, number, state, CI)  -> the pull request pill, `jc20.q`;
 *   - the branch is on the remote, with no PR yet (`zyf`)    -> Create PR, `bsu` case 0;
 *   - the branch is only on this computer (`xyf`)            -> Local changes, `bsu` case 2.
 * So the pills never stack: one branch state, one pill. CI is not a pill of its own there: it is
 * the dot and "CI" inside the pull request pill, and its sentence ("CI: checks in progress") is
 * what a screen reader says. A merged PR says the word Merged in its place. "Copy PR number" is
 * the pull request pill's hold menu, not a pill.
 *
 * The user removed the Diff pill on 2026-10-12; there is none here.
 *
 * Every pill rests on something Orca answered: the PR read, the PR's own checks, the host's
 * review-creation eligibility. A read that failed, has not come back, or names a state the app has
 * no pill for draws nothing. A guess would be a pill that says "Local changes" over a branch that
 * is on GitHub.
 */

/** `session_pill_local_changes_hint`, with the app's own apostrophe. */
export const LOCAL_CHANGES_HINT =
  'This branch is on your computer. Ask Claude to push when you’re ready to open a PR.'

/** The hint's widest it may be, in dp (`jc20.g`: widthIn(max = 280)). */
export const LOCAL_CHANGES_HINT_MAX_WIDTH = 280

export type SessionPrState = PRState

/** The colour a pull request state takes, named by role so the view resolves it from the live
 *  theme (success = open, muted = draft, danger = closed, merged = the merged violet). */
export type SessionPrTint = 'success' | 'muted' | 'danger' | 'merged'

export type SessionCiStatus = 'pending' | 'passed' | 'failed' | 'unavailable'

export type SessionPill =
  | {
      kind: 'pull-request'
      number: number
      /** `#7701`, the app's `jc20.B`. */
      label: string
      state: SessionPrState
      /** The state's word (`ccr_pr_status_*`); the icon's description, and the merged pill's text. */
      stateLabel: string
      tint: SessionPrTint
      /** Null for a PR with no checks, and for a merged PR, which says Merged in its place. */
      ci: SessionCiStatus | null
      /** `session_pill_pull_request_numbered`: "Pull request #7701". */
      spoken: string
      url: string | null
    }
  | { kind: 'create-pr'; label: 'Create PR' }
  | { kind: 'local-changes'; label: 'Local changes'; hint: string }

const STATE_LABELS: Record<SessionPrState, string> = {
  open: 'Open',
  draft: 'Draft',
  closed: 'Closed',
  merged: 'Merged'
}

const STATE_TINTS: Record<SessionPrState, SessionPrTint> = {
  open: 'success',
  draft: 'muted',
  closed: 'danger',
  merged: 'merged'
}

/** `session_pill_ci_status_*`: what the CI part of the pull request pill says to a screen reader. */
export function sessionCiSpoken(ci: SessionCiStatus): string {
  switch (ci) {
    case 'pending':
      return 'CI: checks in progress'
    case 'passed':
      return 'CI: all checks passed'
    case 'failed':
      return 'CI: checks failing'
    case 'unavailable':
      return 'CI: status unavailable'
    default: {
      const unreachable: never = ci
      return unreachable
    }
  }
}

/**
 * The check roll-up for one PR, through the same classifier the branch card's chip and the Checks
 * list use, so the pill cannot read green over a list that reads red. A checks read that failed is
 * "status unavailable", never a pass; a PR with no checks has no CI part at all.
 */
function ciStatus(data: Extract<PrSidebarState, { kind: 'ready' }>['data']): SessionCiStatus | null {
  if (data.checksError !== null) {
    return 'unavailable'
  }
  const checks = summarizeProviderChecks(data.checks)
  if (checks.total === 0) {
    return null
  }
  if (checks.failed > 0) {
    return 'failed'
  }
  if (checks.pending > 0) {
    return 'pending'
  }
  // Only neutral checks left: they exist but say nothing about passing.
  return checks.passed > 0 ? 'passed' : 'unavailable'
}

export function buildSessionPills(input: {
  /** The repo has a hosted-review remote (the GitHub probe settled to yes). */
  hosted: boolean
  /** The worktree's branch; null on a detached HEAD, mid-rebase, or a folder workspace. */
  branch: string | null
  pr: PrSidebarState
  /** The host's answer to "could this branch open a review now?" (only read for a branch with no PR). */
  eligibility: MobileCreatePrEligibilityState
}): SessionPill[] {
  if (!input.hosted || !input.branch) {
    return []
  }
  const { pr } = input
  if (pr.kind === 'ready') {
    const { number, state, url } = pr.data.pr
    return [
      {
        kind: 'pull-request',
        number,
        label: `#${number}`,
        state,
        stateLabel: STATE_LABELS[state] ?? state,
        tint: STATE_TINTS[state] ?? 'muted',
        ci: state === 'merged' ? null : ciStatus(pr.data),
        spoken: `Pull request #${number}`,
        url: url || null
      }
    ]
  }
  if (pr.kind !== 'none') {
    return []
  }
  // No PR is a fact only once the read said so; what the branch can do next is the host's word.
  // A newer read in flight keeps the last answer on screen rather than blinking the pill out.
  const { eligibility } = input
  const answer =
    eligibility.kind === 'ready' || eligibility.kind === 'loading' ? eligibility.eligibility : null
  if (!answer) {
    return []
  }
  // Pushable: the review can be opened now, or after the one push the host names. That is the
  // app's "pushed" branch.
  if (answer.canCreate === true || answer.blockedReason === 'needs_push') {
    return [{ kind: 'create-pr', label: 'Create PR' }]
  }
  // No remote branch at all: the app's "local" branch. Other blocks (a default branch, a
  // detached HEAD, an unsupported provider) say nothing about where the branch lives.
  if (answer.blockedReason === 'no_upstream') {
    return [{ kind: 'local-changes', label: 'Local changes', hint: LOCAL_CHANGES_HINT }]
  }
  return []
}

/**
 * What the pull request pill's hold menu does. The app's "Copy PR number" (`session_pill_copy_pr_number`)
 * hands the number to a handler whose body is not readable in the decompile, so this copies what
 * the pill shows, "#7701", and says so in the wording of the header menu's own toasts. A copy that
 * did not land says that: a dead tap is indistinguishable from a slow one.
 */
export function sessionPillActions(deps: {
  clipboard: ClipboardWriter
  showToast: (message: string, durationMs?: number) => void
}) {
  return {
    copyPrNumber: async (number: number) => {
      try {
        await deps.clipboard.writeText(`#${number}`)
        deps.showToast('PR number copied')
      } catch {
        deps.showToast("Couldn't copy PR number", 1500)
      }
    }
  }
}

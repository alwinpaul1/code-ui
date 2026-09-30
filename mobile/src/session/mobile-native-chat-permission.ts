import type {
  AgentJournalApprovalMatchedAskRule,
  AgentJournalApprovalSubject
} from '../../../src/shared/agent-session-journal-types'
import { clipWithEllipsis } from '../text/whole-character-cut'
import { isClaudePlanFeedbackOptionLabel } from './claude-plan-permission'
import { parseAgentQuestion } from './mobile-native-chat-question'
import { codeFenceStarts, collectOptionLists } from './mobile-native-chat-question-lists'

// Agent permission asks (e.g. Claude/Codex "Do you want to proceed?") surface
// as plain TUI text in the agent's last assistant message — there is no
// structured permission event on mobile. We detect them heuristically so the
// native chat can render tappable Allow/Deny buttons instead of forcing the
// user to type into the composer. Be conservative: only fire when the agent is
// actually paused (blocked/waiting) AND the text reads like an approval ask.

/** A detected permission prompt, rendered as a card with tappable options.
 *  Each option's `send` is the literal string to write back to the agent
 *  (e.g. "y", "1") when the user taps it. */
export type MobileChatPermission = {
  title: string
  displayName?: string
  description?: string
  decisionReason?: string
  blockedPath?: string
  matchedAskRule?: AgentJournalApprovalMatchedAskRule
  subject?: AgentJournalApprovalSubject
  detail?: string
  command?: string
  /** Structured prompt identity, present only when the host can cancel it exactly. */
  prompt?: { itemId: string; expectedRevision: number }
  options: Array<{ label: string; send: string }>
}

/** Identity of the prompt, not of its rendering. The card keys its remount on
 *  this, and its in-flight guard is component-local, so keying on the whole
 *  object remounted the card whenever the screen parse flipped its options —
 *  re-enabling the buttons mid-send, with no "waiting for agent" left, while
 *  the first keystroke was still crossing the relay. Options are presentation;
 *  what identifies the prompt is what it is asking. */
export function mobileChatPermissionKey(permission: MobileChatPermission): string {
  return [permission.title, permission.command ?? '', permission.detail ?? ''].join('\u0000')
}

const ESCAPE = String.fromCharCode(27)

/** Parse the live `agentStatus.interactivePrompt` approval envelope
 *  (`{ approval: { tool, summary } }`, emitted by the host on a PermissionRequest)
 *  into an Allow/Deny card. This is the reliable, agent-emitted signal — unlike
 *  detectAgentPermission it doesn't depend on heuristic text parsing. The default
 *  sends (number for allow, Escape for deny) match the common TUI approval prompt;
 *  detectAgentPermission still takes precedence when it can read the real numbered
 *  options from the prompt text. */
export function parseApprovalFromStatus(
  interactivePrompt: string | undefined | null
): MobileChatPermission | null {
  if (!interactivePrompt) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(interactivePrompt)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const approval = (parsed as { approval?: unknown }).approval
  if (!approval || typeof approval !== 'object') {
    return null
  }
  const tool = (approval as { tool?: unknown }).tool
  if (typeof tool !== 'string' || tool.length === 0) {
    return null
  }
  const summary = (approval as { summary?: unknown }).summary
  return {
    title: `Allow ${tool}?`,
    detail: typeof summary === 'string' && summary.length > 0 ? summary : undefined,
    options: [
      { label: 'Allow', send: '1' },
      { label: 'Deny', send: ESCAPE }
    ]
  }
}

type PermissionInput = {
  state?: string
  lastAssistantMessage?: string
  toolName?: string
  toolInput?: unknown
}

// States where the agent is paused waiting on the human. Only these can yield a
// permission prompt — a "working" agent is mid-turn and must not be answered.
const PAUSED_STATES: ReadonlySet<string> = new Set(['blocked', 'waiting'])

// Phrases that read as an approval request. Kept broad but anchored to
// approval/permission language so ordinary prose doesn't trip detection.
const PERMISSION_PATTERNS: RegExp[] = [
  /\bpermission\b/i,
  /\bapprove\b/i,
  /\bapproval\b/i,
  /\ballow\b/i,
  /\bdeny\b/i,
  /\bgrant\b/i,
  /\bauthorize\b/i,
  /\bdo you want to\b/i,
  /\bwould you like to\b/i,
  /\bproceed\?/i,
  /\bconfirm\b/i,
  /\(y\/n\)/i,
  /\by\/n\b/i,
  /\byes\/no\b/i,
  /\bplease confirm\b/i
]

function looksLikePermissionAsk(text: string): boolean {
  return PERMISSION_PATTERNS.some((re) => re.test(text))
}

// How an option of an approval menu begins, once the emphasis in front of it
// is gone: a way to say yes, or a way to say no. Claude Code's plan review
// says no with "Tell Claude what to change" (claude-plan-permission.ts).
// "Decline", "Not now" and "Not yet" are agent prose, no captured screen: a
// menu of "Approve / Decline" or "Yes / Not now" lost its card to the question
// card without them (2026-10-01). "Not sure" is no way to say no.
const AFFIRMS = /^(?:yes|allow|approve|always|proceed)(?![\p{L}\p{N}])/iu
const REFUSES =
  /^(?:no|deny|decline|reject|cancel|skip|not\s+(?:now|yet)|don['’]t|do\s+not)(?![\p{L}\p{N}])/iu

function approvalAnswer(label: string): 'yes' | 'no' | null {
  const plain = label.replace(/^[*_`]+/, '')
  if (AFFIRMS.test(plain)) {
    return 'yes'
  }
  return REFUSES.test(plain) || isClaudePlanFeedbackOptionLabel(plain) ? 'no' : null
}

/** Every label answers the ask: "Yes", "No, and tell Claude…", "Allow". */
function readsAsApproval(labels: readonly string[]): boolean {
  return labels.every((label) => approvalAnswer(label) !== null)
}

/**
 * The reply's approval menu: a numbered list, outside code fences, of two or
 * more options that all answer the ask, with a way to say yes AND a way to
 * say no. Steps that all begin "Skip…", "Cancel…" are still steps. With more
 * than one, the last: the menu is what the reply ends on, and a list of
 * findings or notes around it is not choices. Null when there is none: a
 * numbered list that is not a menu sent a step, or a choice of database, as
 * the answer to "Do you want to go ahead?" (2026-09-30).
 */
function approvalMenu(text: string): MobileChatPermission['options'] | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const lists = collectOptionLists(lines, codeFenceStarts(lines))
  for (let at = lists.length - 1; at >= 0; at--) {
    const { items } = lists[at]
    const options = items.flatMap(({ label, token }) =>
      token != null && /^\d+$/.test(token) ? [{ label, send: token }] : []
    )
    const answers = options.map(({ label }) => approvalAnswer(label))
    if (
      options.length >= 2 &&
      options.length === items.length &&
      answers.includes('yes') &&
      answers.includes('no') &&
      !answers.includes(null)
    ) {
      return options
    }
  }
  return null
}

// Whether a label reads as "allow for every future call" rather than just once.
function isAlwaysLabel(text: string): boolean {
  return /\balways\b|don't ask again|do not ask again|for the rest|this session/i.test(text)
}

// Cut at `max` code units, never through an emoji (a half drew a broken glyph).
function shortLabel(text: string, max = 40): string {
  return clipWithEllipsis(text.replace(/\s+/g, ' ').trim(), max)
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? ''
}

/**
 * Heuristically detect an agent permission ask from its paused-state context.
 * Returns a renderable prompt, or null when the agent is working, the text
 * doesn't read like an approval request, or it asks the reader to choose
 * (the question card's, which a permission card would hide).
 */
export function detectAgentPermission(input: PermissionInput): MobileChatPermission | null {
  // Only answer a genuinely paused agent. A working agent is mid-turn.
  if (!input.state || !PAUSED_STATES.has(input.state)) {
    return null
  }

  const text = typeof input.lastAssistantMessage === 'string' ? input.lastAssistantMessage : ''
  if (!text.trim()) {
    return null
  }

  if (!looksLikePermissionAsk(text)) {
    return null
  }

  const detail = shortLabel(firstLine(text), 160) || undefined

  // Prefer an explicit numbered menu ("1. Yes  2. No, and tell…") — its labels
  // and send-digits come straight from the agent, so no guessing.
  const menu = approvalMenu(text)
  if (menu) {
    return { title: 'Permission requested', detail, options: menu }
  }
  // "Which database do you want to use? 1. Postgres 2. SQLite" asks for a
  // choice, not a yes: leave it to the question card. A list of Yes and No
  // bullets, or one lone "1. Yes", still asks for a yes.
  const question = parseAgentQuestion(text)
  if (question && !readsAsApproval(question.options)) {
    return null
  }

  // Otherwise fall back to a y/n prompt. We surface "Allow always" only when the
  // text actually offers a persistent option, to avoid sending a token the agent
  // doesn't understand.
  const options: MobileChatPermission['options'] = [
    { label: 'Allow', send: 'y' },
    { label: 'Deny', send: 'n' }
  ]
  if (isAlwaysLabel(text)) {
    options.splice(1, 0, { label: 'Allow always', send: 'a' })
  }

  return { title: 'Permission requested', detail, options }
}

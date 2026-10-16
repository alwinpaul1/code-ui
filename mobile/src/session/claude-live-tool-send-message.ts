import { primitiveInput, stringInput, unreachable } from './claude-live-tool-inputs'

// The live tool row's words for a SendMessage call (com.anthropic.claude 1.261013.20): what it is
// (`hqz.m`, hqz.java:506-552, with the classes ipu/hpu/npu/jpu/kpu/lpu/mpu), its present-tense verb
// (single-bw30 bw30.java:700-752, strings `ccr_verb_*`), and its summary (`opu.a()`, `hqz.k` and
// `hqz.l`, hqz.java:466-504). claude-live-tool-row.ts has the rest of the row.

/** `hqz.b`, hqz.java:16: a SendMessage to another session. */
const OTHER_SESSION_PREFIXES = ['uds:', 'bridge:', '/']
/** `hqz.c`, hqz.java:17: an agent id. */
const AGENT_ID = /^[a-z0-9]{9}$/

/** `hqz.l`: memory tags out, whitespace runs to one space, at most 80 characters (79 and "…"). */
function cleanSummary(text: string | null): string | null {
  if (text === null || text.length === 0) {
    return null
  }
  const plain = text
    .replace(/<\/?cc-memory[^>]*>/g, '')
    .replace(/[\s\p{Z}]+/gu, ' ')
    .trim()
  if (plain.length === 0) {
    return null
  }
  if (plain.length <= 80) {
    return plain
  }
  let head = plain.slice(0, 79)
  // `xpz.i`: never end on half a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(head)) {
    head = head.slice(0, -1)
  }
  return `${head.trimEnd()}…`
}

export type SendMessageKind =
  | { kind: 'otherSession' }
  | { kind: 'agent'; summary: string | null; message: unknown }
  | { kind: 'teammate'; summary: string | null; message: unknown }
  | { kind: 'named'; to: string; summary: string | null; message: unknown }
  | { kind: 'planVerdict'; to: string; approved: boolean; feedback: string | null }
  | { kind: 'shutdownRequested'; to: string; reason: string | null }
  | { kind: 'shutdownVerdict'; to: string; approved: boolean; reason: string | null }

/** `hqz.a`: the message's `approve`, read as the text "true" or "false". */
function approveOf(message: Record<string, unknown>): boolean | null {
  const value = primitiveInput(message, 'approve')
  return value === 'true' ? true : value === 'false' ? false : null
}

/** `hqz.m` (hqz.java:506-552): what a SendMessage call is. */
export function sendMessageKind(map: Record<string, unknown>): SendMessageKind {
  const to = stringInput(map, 'to') ?? ''
  if (OTHER_SESSION_PREFIXES.some((prefix) => to.startsWith(prefix))) {
    return { kind: 'otherSession' }
  }
  if (to.length > 0) {
    const message = map.message
    if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
      const fields = message as Record<string, unknown>
      const type = stringInput(fields, 'type')
      if (type === 'shutdown_response') {
        const approved = approveOf(fields)
        if (approved !== null) {
          return { kind: 'shutdownVerdict', to, approved, reason: stringInput(fields, 'reason') }
        }
      } else if (type === 'plan_approval_response') {
        const approved = approveOf(fields)
        if (approved !== null) {
          return { kind: 'planVerdict', to, approved, feedback: stringInput(fields, 'feedback') }
        }
      } else if (type === 'shutdown_request') {
        return { kind: 'shutdownRequested', to, reason: stringInput(fields, 'reason') }
      }
    }
  }
  const summary = stringInput(map, 'summary')
  const message = map.message
  if (AGENT_ID.test(to)) {
    return { kind: 'agent', summary, message }
  }
  return to.length > 0 ? { kind: 'named', to, summary, message } : { kind: 'teammate', summary, message }
}

/** `bw30.f` for SendMessage, present form (bw30.java:700-752; strings `ccr_verb_*`). */
export function sendMessageVerb(kind: SendMessageKind): string {
  switch (kind.kind) {
    case 'otherSession':
      return 'Messaging another session'
    case 'agent':
      return 'Messaging agent'
    case 'teammate':
      return 'Messaging teammate'
    case 'named':
      return `Messaging @${kind.to}`
    case 'planVerdict':
      return kind.approved ? `Approving plan from @${kind.to}` : `Rejecting plan from @${kind.to}`
    case 'shutdownRequested':
      return `Asking @${kind.to} to shut down`
    case 'shutdownVerdict':
      return kind.approved ? `Approving shutdown request from @${kind.to}` : `Declining shutdown request from @${kind.to}`
    default:
      return unreachable(kind)
  }
}

/** `opu.a()`: the SendMessage's summary line (ipu/hpu/npu `hqz.k`, the verdicts `hqz.l`). */
export function sendMessageSummary(kind: SendMessageKind): string | null {
  switch (kind.kind) {
    case 'otherSession':
      return null
    case 'planVerdict':
      return cleanSummary(kind.feedback)
    case 'shutdownRequested':
    case 'shutdownVerdict':
      return cleanSummary(kind.reason)
    case 'agent':
    case 'teammate':
    case 'named': {
      const summary = cleanSummary(kind.summary)
      if (summary !== null) {
        return summary
      }
      const message = kind.message
      if (typeof message === 'string') {
        return cleanSummary(message.trim() || null)
      }
      if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
        const fields = message as Record<string, unknown>
        return cleanSummary(stringInput(fields, 'feedback')) ?? cleanSummary(stringInput(fields, 'reason'))
      }
      return null
    }
    default:
      return unreachable(kind)
  }
}

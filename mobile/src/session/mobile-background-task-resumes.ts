import { isToolCallBlock, isToolResultBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { readString, truncate, type Launch, type Notification } from './mobile-background-task-transcript'

// ─── An agent the lead resumed, as the lead's own transcript records it ─────
//
// A background agent's run ends with a <task-notification>, and Claude Code
// says on every agent notification that "the same task-id may notify more
// than once": the lead can SendMessage a stopped agent and it runs again. The
// lead's transcript records that restart only in SendMessage's result, which
// is JSON (the same template in the 2.1.281, 2.1.282 and 2.1.283 bundles):
//   {"success":true,"message":"Resuming agent a38e168","resumedAgentId":"a38e1687ac3722765","pin":{…}}
// `message` cuts a raw id to 7 characters; `resumedAgentId` carries it whole.
// Claude Code leaves `resumedAgentId` out when the resumed run already ended
// inside the call (its report is then the result), and, for an agent still in
// memory, when the task record names an owner other than the caller; it does
// not check the owner of one it resumes from disk. A message to an agent that
// is still running is queued ("Message queued for delivery to … at its next
// tool round.") and starts no run; a message to an agent that is not there
// fails (`"success":false`). A teammate's resume ("Teammate … was not
// running; resumed it…") names no task id; the roster judges teammates.
//
// What ends the new run: its next notification or TaskStop in the window, or
// the roster dropping the row. An id-only finished list — the beacon's
// `done=`, and every id an earlier window showed ending — cannot say which
// run it names, so against a roster row it ends nothing. With no host status
// at all it still ends the run: a resumed run that finishes mid-turn has its
// notification dropped by Orca's reader, and nothing else would ever end it.
//
// Why the reader needs it (2026-09-28, Claude Code 2.1.283): a38e1687ac3722765
// stalled at 13:34 ("Agent stalled: no progress for 600s") and never sent
// SubagentStop, so Orca kept its roster row. When the lead resumed it at
// 16:28, SubagentStart found that row and kept its first start, 12:18:28
// (`upsertWorkingClaudeSubagent`). A row older than the notification reads as
// the run the notification ended, so the running agent left the count.

/** One resume the loaded window shows: where it sits and when it was written. */
export type AgentResume = { at: number; timestamp: number | null }

export type AgentResumeReading = { kind: 'resumed'; id: string } | { kind: 'refused'; why: string }

const RESUMING = /^Resuming agent\s/
const PLAIN_RESUMING = /^\s*Resuming agent\s/
const OPENS_OBJECT = /^\s*\{/
const AGENT_ID = /^[A-Za-z0-9_-]+$/

/** Reads one tool result as a SendMessage resume, whatever produced it. Null
 *  for a result that does not claim to resume an agent — a queued message, a
 *  failed send — and a refusal, with the reason, for one that claims a resume
 *  in a shape these builds never write. Whether the result answers a
 *  SendMessage at all is `readSendMessageResume`'s question. */
export function readAgentResume(output: string): AgentResumeReading | null {
  if (PLAIN_RESUMING.test(output)) {
    return { kind: 'refused', why: 'the result says "Resuming agent" as plain text; Claude Code 2.1.281-2.1.283 write it as JSON' }
  }
  // Only a result that could be a resume is parsed; the reader runs on every
  // render. Tested in place: trimming a long output can copy it.
  if (!OPENS_OBJECT.test(output) || (!output.includes('Resuming agent') && !output.includes('"resumedAgentId"'))) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const message = Reflect.get(value, 'message')
  const resumedAgentId = Reflect.get(value, 'resumedAgentId')
  const saysResuming = typeof message === 'string' && RESUMING.test(message)
  if (!saysResuming && resumedAgentId === undefined) {
    return null
  }
  if (Reflect.get(value, 'success') !== true) {
    return { kind: 'refused', why: 'a resume whose "success" is not true' }
  }
  if (!saysResuming) {
    return { kind: 'refused', why: 'a resumedAgentId without the "Resuming agent" message' }
  }
  if (resumedAgentId === undefined) {
    return { kind: 'refused', why: 'no resumedAgentId, which Claude Code leaves out when the task names another owner' }
  }
  if (typeof resumedAgentId !== 'string' || !AGENT_ID.test(resumedAgentId)) {
    return { kind: 'refused', why: 'a resumedAgentId that is not an agent id' }
  }
  return { kind: 'resumed', id: resumedAgentId }
}

/** What the reader's walk has seen of SendMessage: the resumes it read, and
 *  the calls of the current step that still wait for a result, each as the
 *  names it addressed (`to`, `recipient`). A step is the stretch of calls and
 *  results between two messages with no tool block (the lead's reply, the
 *  next prompt, an interruption), so a call whose result never landed does
 *  not stay waiting into a later turn. Orca's reader hands each parallel call
 *  and each result over as its own message, and they interleave in any
 *  order: a result can land before a later call of the same response. Only a
 *  resume of the agent a call addressed ends that call's wait; a result that
 *  is not one (queued, failed, or never recorded) leaves it waiting until the
 *  step ends. */
export type ResumeTracker = { resumes: Map<string, AgentResume>; targets: string[][]; resumedThisStep: Set<string> }

export function createResumeTracker(): ResumeTracker {
  return { resumes: new Map(), targets: [], resumedThisStep: new Set() }
}

/** Called once per message, before its blocks. */
export function trackMessage(sends: ResumeTracker, message: NativeChatMessage): void {
  if (!message.blocks.some((block) => isToolCallBlock(block) || isToolResultBlock(block))) {
    sends.targets = []
    sends.resumedThisStep.clear()
  }
}

/** Called for every tool call. */
export function trackCall(sends: ResumeTracker, name: string, input: unknown): void {
  if (name === 'SendMessage') {
    sends.targets.push([readString(input, 'to'), readString(input, 'recipient')].filter((target): target is string => target !== null))
  }
}

/** Whether a call addressed to `target` resumed `id`: by id, or by the name a
 *  named agent's `a<name>-<hex>` id carries. */
function addresses(target: string, id: string): boolean {
  return target === id || (id.startsWith(`a${target}-`) && /^[0-9a-f]+$/i.test(id.slice(target.length + 2)))
}

/** Called for every tool result, with where its message sits: records the
 *  resume of an agent a waiting SendMessage of this step addressed, taking
 *  that call off the wait, and logs a refused one. A result read while no
 *  SendMessage waits is not asked about at all, and one whose resumed agent
 *  no waiting call addressed is refused: a command beside a SendMessage to
 *  another agent can print a resume's JSON. What still passes is a printout of
 *  the very agent a waiting call addressed, in the same step. */
export function trackResult(sends: ResumeTracker, output: string, messageId: string, place: AgentResume): void {
  const reading = readSendMessageResume(sends, output)
  if (reading?.kind === 'resumed') {
    sends.resumes.set(reading.id, place)
  } else if (reading) {
    logRefusedResume(messageId, reading.why)
  }
}

function readSendMessageResume(sends: ResumeTracker, output: string): AgentResumeReading | null {
  if (sends.targets.length === 0) {
    return null
  }
  const reading = readAgentResume(output)
  if (reading?.kind !== 'resumed') {
    return reading
  }
  const index = sends.targets.findIndex((targets) => targets.some((target) => addresses(target, reading.id)))
  if (index === -1) {
    // A printout of the agent can take its call's place before the real
    // result lands; the agent counts either way, so nothing is refused.
    return sends.resumedThisStep.has(reading.id)
      ? null
      : { kind: 'refused', why: `${reading.id} is not the agent any SendMessage waiting in this step addressed` }
  }
  sends.targets.splice(index, 1)
  sends.resumedThisStep.add(reading.id)
  return reading
}

/** Refusals remembered, oldest forgotten first. Far above the results that
 *  answer a SendMessage in any one window, so a window never cycles through
 *  it and re-logs on every render. */
const LOGGED_MAX = 1000
const logged = new Set<string>()

/** One line per refused result, however often the reader runs over it.
 *  `messageId` is the transcript message that holds the result. */
function logRefusedResume(messageId: string, why: string): void {
  const key = `${messageId}\n${why}`
  if (logged.has(key)) {
    return
  }
  if (logged.size >= LOGGED_MAX) {
    const oldest = logged.values().next().value
    if (oldest !== undefined) {
      logged.delete(oldest)
    }
  }
  logged.add(key)
  console.warn(`[background-tasks] not counted as a resumed agent (message ${messageId}): ${why}`)
}

/** Whether the ending the reader holds for an agent came after its resume,
 *  so the resumed run is over. A notification or a TaskStop in the window is
 *  placed by its position. A foreground run's report is placed after the
 *  window (`settleAgentLaunches`), so only its time can say; with no time to
 *  compare, the run is taken as over rather than guessed alive. A tie is over
 *  too: in one message the results are read before the text. */
function endedAfter(ending: Notification, resume: AgentResume, lastPosition: number): boolean {
  if (ending.at <= lastPosition) {
    return ending.at >= resume.at
  }
  return ending.timestamp === null || resume.timestamp === null || ending.timestamp >= resume.timestamp
}

/** Puts each resumed agent's new run in place of the run it followed: an
 *  ending from before the resume is dropped, and the run is timed from the
 *  resume. An agent whose launch has slid out of the window gets a launch of
 *  its own, named by `describe` when anything names it. Mutates the reader's
 *  own maps, which it builds fresh on every walk. */
export function applyAgentResumes(args: {
  launches: Map<string, Launch>
  notifications: Map<string, Notification>
  resumes: ReadonlyMap<string, AgentResume>
  lastPosition: number
  describe: (id: string) => string | undefined
}): void {
  const { launches, notifications, resumes, lastPosition } = args
  for (const [id, resume] of resumes) {
    const ending = notifications.get(id)
    const launch = launches.get(id)
    if ((ending && endedAfter(ending, resume, lastPosition)) || (launch && launch.kind !== 'agent')) {
      continue
    }
    notifications.delete(id)
    if (launch) {
      launch.startedAt = resume.timestamp ?? launch.startedAt
    } else {
      launches.set(id, { id, kind: 'agent', title: truncate(args.describe(id) || 'Agent'), startedAt: resume.timestamp, label: null })
    }
  }
}

import { SESSION_A } from './ccr-session-api-2026-10-14'

// ─── A slash command's own output, as Remote Control sends it ───────────────
//
// THE RECORD, verbatim (Claude Code 2.1.300, 2026-10-15 13:20:36, the session's transcript on this
// Mac, NexOS-Mobile-wt/tablet-cab-redesign, line 3058; fields that say nothing about the row
// trimmed: parentUuid, userType, entrypoint, cwd, sessionId, gitBranch). The user typed
// "/code-review 1384 and 12 medium --fix"; Claude Code started the skill as a background agent and
// recorded what it printed as a `system` `local_command`:
export const FORKED_SKILL_LOCAL_COMMAND_RECORD =
  '{"isSidechain":false,"type":"system","subtype":"local_command","content":"<local-command-stdout>Running in the background as @code-review</local-command-stdout>\\n<forked-skill-launch>{\\"agentId\\":\\"ac38305b29c210f73\\",\\"skillName\\":\\"code-review\\",\\"description\\":\\"/code-review 1384 and 12 medium --fix\\"}</forked-skill-launch>","level":"info","timestamp":"2026-10-15T13:20:36.125Z","uuid":"06fcd8a8-6dfe-4437-8398-f830ecbef34e","isMeta":false,"version":"2.1.300"}'

const record = JSON.parse(FORKED_SKILL_LOCAL_COMMAND_RECORD) as { content: string; uuid: string; timestamp: string }

/** The record's `content`: what Claude Code sends as the event's `local_command_source`. */
export const FORKED_SKILL_LOCAL_COMMAND_SOURCE = record.content
export const FORKED_SKILL_LOCAL_COMMAND_UUID = record.uuid

/**
 * The text of the event's message: the record with its stdout envelope unwrapped and everything
 * else kept, `<forked-skill-launch>` included. That is Claude Code 2.1.300's own conversion for
 * an SDK client (the minified `Uqt`: each `<local-command-stdout>`/`-stderr>` is replaced by its
 * contents, the rest is kept, the whole trimmed; empty → no event).
 */
export const FORKED_SKILL_TWIN_TEXT =
  'Running in the background as @code-review\n<forked-skill-launch>{"agentId":"ac38305b29c210f73","skillName":"code-review","description":"/code-review 1384 and 12 medium --fix"}</forked-skill-launch>'

/** What the Claude app draws for it (screenshot, 2026-10-15): the tags gone, their contents kept. */
export const FORKED_SKILL_DRAWN_TEXT =
  'Running in the background as @code-review\n{"agentId":"ac38305b29c210f73","skillName":"code-review","description":"/code-review 1384 and 12 medium --fix"}'

/**
 * The Remote Control event for that record. DERIVED, NOT CAPTURED: no event of this kind was
 * recorded off the wire (the phone's kept copy is not readable from adb on a release build). The
 * shape is what Claude Code 2.1.300 builds for an SDK client from a `local_command` whose content
 * holds a stdout or stderr envelope (`Uqt`, yielded as "yield-twin assistant (local_command)"):
 * an `assistant` message whose model is `<synthetic>` (`Pi`), `stop_reason: "end_turn"`,
 * `parent_tool_use_id: null`, and the record's content as `local_command_source`. The Claude app
 * 1.261009.20 reads the same field (`SdkMessageEvent.local_command_source`, tkt.java:47) and tests
 * for the same model (alt.g, alt.java:59-69), which is what ties the two together. The event's
 * envelope (`event_id`, `sequence_num`, `created_at`) is made up in the shape the other fixtures use.
 */
export function forkedSkillTwinEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    created_at: record.timestamp,
    event_id: 'evt_forked_skill_twin',
    payload: {
      local_command_source: FORKED_SKILL_LOCAL_COMMAND_SOURCE,
      message: {
        content: [{ text: FORKED_SKILL_TWIN_TEXT, type: 'text' }],
        id: 'b6a5f0c6-8d76-4a8e-9a43-1e44a1f1c0d2',
        model: '<synthetic>',
        role: 'assistant',
        stop_reason: 'end_turn',
        stop_sequence: null,
        type: 'message'
      },
      parent_tool_use_id: null,
      session_id: SESSION_A,
      timestamp: record.timestamp,
      type: 'assistant',
      uuid: FORKED_SKILL_LOCAL_COMMAND_UUID,
      ...overrides
    },
    sequence_num: '412'
  }
}

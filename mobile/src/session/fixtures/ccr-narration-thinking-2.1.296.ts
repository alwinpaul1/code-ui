import { SESSION_A, event } from './ccr-session-api-2026-10-14'

// ─── An Opus 5.5 turn's thinking blocks, as Claude Code 2.1.296 recorded them (2026-10-14)
//
// Copied from a real session transcript on this machine (session 211c47c2…, events 853-857 of
// its lead): a Read call and its result, then two thinking-only assistant events, then an Agent
// call. Text and ids are as recorded; tool inputs and results are cut short, and each signature is
// cut after its header, which is where the block's kind sits (protobuf field 2 → 1 → 8:
// "thinking" or "narration", base64 `…AUIIdGhpbmtpbmc…` / `…AUIJbmFycmF0aW9u…`).
//
// What every thinking block of that model looked like in two whole sessions (1,886 blocks):
//  - kind "thinking": the words are always EMPTY, a signature only;
//  - kind "narration": always words, a short summary of the work between tool calls.
//
// Claude Code 2.1.300 tells a renderer which is which on the event, beside `message`:
// `narration_block_indexes`, "ascending zero-based indexes into this frame's `message.content` of
// the thinking blocks whose signature the server tagged block_kind 'narration' (server summaries
// of the prose between tool calls, not the model's own reasoning)" (its SDK schema, read from the
// 2.1.300 bundle's strings; the CLI's `ucs` fills it). The transcript file does not carry the
// field, so the frames below add it as the CLI writes it for a one-block frame: `[0]`. No CCR
// event carrying it has been captured; the Claude app 1.261013.20 reads it as `n8u.w`.

const NARRATION_TEXT =
  "That confirms the dictation UI behavior from the recording—composer collapses with cancel, waveform, stop, and send controls, then returns to normal on exit. I'll now build this in an isolated agent worktree.\n\n"

export const NARRATION_WORDS = NARRATION_TEXT.trim()

const lead = (payload: Record<string, unknown>) => event({ session_id: SESSION_A, parent_tool_use_id: null, ...payload })
const assistant = (uuid: string, content: unknown[], extra: Record<string, unknown> = {}) =>
  lead({ type: 'assistant', uuid, message: { role: 'assistant', model: 'claude-opus-5-5', content }, ...extra })

export const readCall = () =>
  assistant('687122e4-d589-4bc0-8674-347b169b4bff', [
    {
      type: 'tool_use',
      id: 'toolu_01QbiBhpWpiaPTg1oYLQAQQu',
      name: 'Read',
      input: { file_path: '/private/tmp/claude-501/scratchpad/vid2/rows.png' },
      caller: { type: 'direct' }
    }
  ])

export const readResult = () =>
  lead({
    type: 'user',
    uuid: '147dbca5-ebdf-40ba-9386-0bc70bf30786',
    message: { role: 'user', content: [{ tool_use_id: 'toolu_01QbiBhpWpiaPTg1oYLQAQQu', type: 'tool_result', content: 'read ok', is_error: false }] }
  })

/** A kind-"thinking" block: no words, a signature only. */
export const signatureOnlyThought = (uuid = '50d79714-d196-4c74-8e11-364cda26ca40') =>
  assistant(uuid, [{ type: 'thinking', thinking: '', signature: 'CAQS0xQKEAgSGAI4AUIIdGhpbmtpbmcSDIoo8ub18WFg/JZ+eBoMNT3nBTtMklQm4Mf+' }])

/** A kind-"narration" block, named by the frame's `narration_block_indexes` as 2.1.300 sends it.
 *  `indexes: null` is the frame a CLI from before the field sends (no field at all). */
export const narration = (indexes: unknown = [0], uuid = 'be3accc7-b6b6-4f3d-8c46-d95ab04b8f00') =>
  assistant(
    uuid,
    [{ type: 'thinking', thinking: NARRATION_TEXT, signature: 'CAQS9AkKEQgSGAI4AUIJbmFycmF0aW9uEgwqnwLILs3lQEx06yQaDD+1KihMLJN29Dqc' }],
    indexes === null ? {} : { narration_block_indexes: indexes }
  )

export const agentCall = () =>
  assistant('bc345aef-fab3-4aaa-a5cf-e94ccc2b1513', [
    {
      type: 'tool_use',
      id: 'toolu_01EqXGWGPk3dY45pgEHG1kzD',
      name: 'Agent',
      input: { description: 'Build Claude-style recording row', subagent_type: 'general-purpose', model: 'opus', isolation: 'worktree', prompt: 'Feature in Code UI', run_in_background: 'true' },
      caller: { type: 'direct' }
    }
  ])

// A second real stretch of the same session (its events 3-6, 2026-10-14T00:10): a Bash call and
// its result, a signature-only thought, and the next Bash call.
export const ghRunListCall = () =>
  assistant('4ccc853b-d890-41f7-a0ab-4abfc3e28b04', [
    { type: 'tool_use', id: 'toolu_01LYER97Xue2wxD8tLkqfxg4', name: 'Bash', input: { command: 'gh run list --limit 15' }, caller: { type: 'direct' } }
  ])

export const ghRunListResult = () =>
  lead({
    type: 'user',
    uuid: '6ef1753d-a380-4267-bd8c-96fb919ca4d7',
    message: { role: 'user', content: [{ tool_use_id: 'toolu_01LYER97Xue2wxD8tLkqfxg4', type: 'tool_result', content: 'Mobile Android Release\tpush\tmobile-android-v0.9.136\tfailure', is_error: false }] }
  })

export const thoughtBetweenCommands = () =>
  assistant('b62c2e46-1c0a-4fa4-86d7-3a22e716f168', [{ type: 'thinking', thinking: '', signature: 'CAQS/wUKEAgSGAI4AUIIdGhpbmtpbmcSDFxSiBrMhDxqrEuP' }])

export const ghRunViewCall = () =>
  assistant('ae17d174-c179-4a48-bfb8-0350bb56919c', [
    { type: 'tool_use', id: 'toolu_01LbXWQ7Ye5RjmaDCAe6cne3', name: 'Bash', input: { command: 'gh run view 38485950939 --log-failed | tail -60; gh release list --limit 4' }, caller: { type: 'direct' } }
  ])

export const prompt = (uuid: string, text: string) => lead({ type: 'user', uuid, message: { role: 'user', content: text } })

import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { parseCcrEvent, type CcrEvent } from './ccr-session-api'
import { decodeCcrEvents, slimCcrEvent } from './ccr-transcript-decode'
import { errorRowOf } from './mobile-native-chat-error-rows'
import { SESSION_A, event } from './fixtures/ccr-session-api-2026-10-14'

// What the Claude app (1.261013.20) draws where Code UI drew red rows:
//  - Stop: Claude Code writes `[Request interrupted by user]` as the user's turn; the app turns
//    it into no text and no row (`u5a.j`, `t5v`), and its `result` row ("Session interrupted")
//    draws nothing (`gy30`). Code UI drew a red "Session interrupted" after every Stop.
//  - An API error is the agent's plain text; only an `api_error` of
//    `claude_code_version_too_old` is replaced, by `ccr_model_requires_newer_cli` (`nx30.f`,
//    the field read in `t5v` as `n8u.o`). Code UI drew a red notice.

const keep = (key: string) => `file:///cache/${encodeURIComponent(key)}`
const asEvent = (raw: Record<string, unknown>): CcrEvent => slimCcrEvent(parseCcrEvent(raw)!, keep)
const rows = (...raws: Record<string, unknown>[]) => decodeCcrEvents(raws.map(asEvent), new WeakMap())

const user = (uuid: string, content: unknown) =>
  event({ type: 'user', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'user', content } })
const assistant = (uuid: string, text: string, extra: Record<string, unknown> = {}) =>
  event({
    type: 'assistant',
    uuid,
    session_id: SESSION_A,
    parent_tool_use_id: null,
    message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] },
    ...extra
  })

const API_ERROR = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)"

function drawsRed(message: NativeChatMessage): boolean {
  return errorRowOf(message) !== null
}

describe('a stopped turn and an API error, as the Claude app draws them', () => {
  it('draws no row at all for the interrupt Claude Code writes after Stop', () => {
    expect(rows(assistant('a1', 'Looking at it.'), user('u1', [{ type: 'text', text: '[Request interrupted by user]' }])).map((row) => row.id)).toEqual(['a1'])
    expect(rows(user('u2', [{ type: 'text', text: '[Request interrupted by user for tool use]' }]))).toEqual([])
  })

  it('draws an API error as the agent’s plain words, not a red row', () => {
    const decoded = rows(assistant('e1', API_ERROR, { isApiErrorMessage: true, error: 'unknown' }))
    expect(decoded).toHaveLength(1)
    expect(decoded[0]!.blocks).toEqual([{ type: 'text', text: API_ERROR }])
    expect(drawsRed(decoded[0]!)).toBe(false)
  })

  it('says to update Claude Code when the model needs a newer one', () => {
    const decoded = rows(
      assistant('e2', 'API Error: 400 {"type":"error","error":{"type":"claude_code_version_too_old"}}', {
        isApiErrorMessage: true,
        api_error: 'claude_code_version_too_old'
      })
    )
    expect(decoded.map((row) => row.blocks)).toEqual([
      [{ type: 'text', text: 'Update Claude Code on the computer running this session to use this model.' }]
    ])
    expect(drawsRed(decoded[0]!)).toBe(false)
  })

  it('keeps every other API error class as the words Claude Code wrote', () => {
    const decoded = rows(assistant('e3', API_ERROR, { isApiErrorMessage: true, api_error: 'overloaded_error' }))
    expect(decoded[0]!.blocks).toEqual([{ type: 'text', text: API_ERROR }])
  })
})

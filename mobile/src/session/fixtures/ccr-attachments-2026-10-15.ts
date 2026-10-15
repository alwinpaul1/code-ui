/**
 * Anthropic events that carry attachments, as the session API returned them on 2026-10-15 for the
 * Remote Control session "Memory limits for agent profiles" (read-only probe, scratchpad/probe/
 * p9-attachments.cjs, 18,514 events, 9 of them with `file_attachments`). Only `trace_context`
 * is dropped; ids, names, timestamps and key sets are the recorded ones.
 *
 * A prompt sent from the Claude app (`source: client`, `client_platform: android`) carries its
 * files NEXT to the message, not inside it: `payload.file_attachments` is a list of
 * `{file_uuid, file_name, is_image}` and `message.content` is a plain string (empty when the
 * prompt was only files). Those three keys are the only ones any of the 16 recorded entries has.
 */
import { parseCcrEvent, type CcrEvent } from '../ccr-session-api'

export const RECORDING_UUID = '15b76837-79e9-4f38-9365-1916bc81e523'

function parsed(raw: Record<string, unknown>): CcrEvent {
  const event = parseCcrEvent(raw)
  if (!event) {
    throw new Error('fixture event did not parse')
  }
  return event
}

function clientEvent(raw: { event_id: string; created_at: string; sequence_num: string; payload: Record<string, unknown> }): CcrEvent {
  return parsed({
    ...raw,
    device_attestation_status: 'DEVICE_ATTESTATION_STATUS_UNSPECIFIED',
    event_type: 'user',
    sent_by_account_id: null,
    source: 'client'
  })
}

/** The same shape with one payload key changed or added, for the refusal cases. */
export function withPayload(base: CcrEvent, patch: Record<string, unknown>): CcrEvent {
  return { ...base, payload: { ...base.payload, ...patch } }
}

/** seq 18128: one recording and a sentence. */
export const RECORDING_PROMPT = clientEvent({
  created_at: '2026-10-15T10:31:04.775597Z',
  event_id: '311f10c7-0f08-46e7-8f74-ff7354535ec0',
  sequence_num: '18128',
  payload: {
    client_platform: 'android',
    file_attachments: [{ file_name: 'Screen_Recording_20261015_123030_Code UI.mp4', file_uuid: RECORDING_UUID, is_image: false }],
    message: { content: "See claude mobile shows nicely and code ui doesn't show fix  that", role: 'user' },
    server_received_wall_ms: 1792060264733,
    type: 'user',
    uuid: '311f10c7-0f08-46e7-8f74-ff7354535ec0'
  }
})

/** seq 8457: a recording and three photos, no words at all (`content` is ""). */
export const FILES_ONLY_PROMPT = clientEvent({
  created_at: '2026-10-14T16:56:30.071478Z',
  event_id: 'a840c88c-bf2b-406e-b0ee-0b4c2d009ae8',
  sequence_num: '8457',
  payload: {
    client_platform: 'android',
    file_attachments: [
      { file_name: 'Screen_Recording_20261014_185614_Claude.mp4', file_uuid: '44f43202-8959-498e-8db9-737c7f302797', is_image: false },
      { file_name: '1000150278.jpg', file_uuid: '2db38c1c-7658-49d5-8ae8-ce5bd159f1d2', is_image: true },
      { file_name: '1000150276.jpg', file_uuid: 'd8f6cfdd-c256-4de4-a4a7-4be7e4aa2f48', is_image: true },
      { file_name: '1000150274.jpg', file_uuid: '3ee84319-4a3b-4d7a-a696-2b713588ea65', is_image: true }
    ],
    message: { content: '', role: 'user' },
    server_received_wall_ms: 1791996990016,
    type: 'user',
    uuid: 'a840c88c-bf2b-406e-b0ee-0b4c2d009ae8'
  }
})

export const SHEET_CALL_ID = 'toolu_0171UAAbDtG6AKTpfE7hbR4s'

/** seq 18137 and 18138: Claude Code Reads a contact sheet (a .jpg) and the picture comes back in
 *  the tool result; `tool_use_result.file` is the CLI's own record of it, with an empty `base64`.
 *  A 1 px PNG stands in for the JPEG's bytes. */
export function readSheetEvents(pictureBase64: string): { call: CcrEvent; result: CcrEvent } {
  const sessionId = 'cse_01QXDNFhxxxxxxxxxxxxxxxx'
  return {
    call: parsed({
      created_at: '2026-10-15T10:29:00.000000Z',
      event_id: 'ev-read-call',
      event_type: 'assistant',
      payload: {
        message: { content: [{ type: 'tool_use', id: SHEET_CALL_ID, name: 'Read', input: { file_path: '/private/tmp/scratchpad/rec3/sheet.jpg' } }], role: 'assistant' },
        parent_tool_use_id: null,
        session_id: sessionId,
        type: 'assistant',
        uuid: 'a-read-sheet'
      },
      sequence_num: '18137',
      source: 'worker'
    }),
    result: parsed({
      created_at: '2026-10-15T10:29:01.000000Z',
      event_id: 'ev-read-result',
      event_type: 'user',
      payload: {
        message: { content: [{ content: [{ source: { data: pictureBase64, media_type: 'image/jpeg', type: 'base64' }, type: 'image' }], tool_use_id: SHEET_CALL_ID, type: 'tool_result' }], role: 'user' },
        parent_tool_use_id: null,
        session_id: sessionId,
        tool_use_result: { file: { base64: '', dimensions: { displayHeight: 1988, displayWidth: 1856, originalHeight: 2572, originalWidth: 2400 }, originalSize: 385572, type: 'image/jpeg' }, type: 'image' },
        type: 'user',
        uuid: 'u-read-sheet-result'
      },
      sequence_num: '18138',
      source: 'worker'
    })
  }
}

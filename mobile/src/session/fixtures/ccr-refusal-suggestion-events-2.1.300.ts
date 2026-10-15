import type { CcrEvent } from '../ccr-session-api'

// ─── Anthropic's refusal, suggestion, summary and missing-file events, as Claude Code 2.1.300 emits them
//
// NOT captured live: none of these has been seen in a recorded session (the 4,000-event capture of
// 2026-10-14 holds none), and no session was driven to make one (a subagent may not launch Claude).
// The field names and nesting are copied from Claude Code 2.1.300's own SDK schemas (its bundle,
// `strings` of ~/.local/share/claude/versions/2.1.300, read 2026-10-15, never run):
//   {type:"system",subtype:"model_refusal_fallback",trigger:"refusal",direction:"retry",scope?,
//    original_model,fallback_model,request_id,api_refusal_category?,api_refusal_explanation?,
//    retracted_message_uuids?,refused_user_message_uuid?,content,uuid,session_id}
//   {type:"system",subtype:"model_refusal_no_fallback",original_model,request_id,api_refusal_category?,
//    api_refusal_explanation?,refused_user_message_uuid?,content,uuid,session_id}
//   {type:"prompt_suggestion",suggestion,uuid,session_id}
//   {type:"tool_use_summary",summary,preceding_tool_use_ids:[…],uuid,session_id,timestamp?}
//   {type:"system",subtype:"file_attachments_missing",message_uuid,sent_count,missing:[{file_uuid,reason}],…}
// and the Claude app 1.261013.20 reads the same names (jau.java's descriptor for the system events,
// c9u.java for prompt_suggestion, pbu.java for tool_use_summary). The `content` strings are the
// shape 2.1.300's own sentence builder (h8e) writes; the app never reads `content`.

export const SESSION = 'cse_01QXrefusalfixture000000'
export const T0 = Date.parse('2026-10-15T12:00:00.000Z')

let seq = 0
export function ccrEvent(payload: Record<string, unknown>, at: number = T0 + seq * 1000): CcrEvent {
  seq += 1
  return { eventId: `evt_refusal_${seq}`, payload: { uuid: `refusal-uuid-${seq}`, session_id: SESSION, ...payload }, sequenceNum: seq, source: 'worker', createdAt: at }
}

export function prompt(uuid: string, text: string, extra: Record<string, unknown> = {}): CcrEvent {
  return ccrEvent({ type: 'user', uuid, parent_tool_use_id: null, message: { role: 'user', content: text }, ...extra })
}

export function refusalFallback(fields: { original: string; fallback: string; category?: string | null; refused?: string | null; parent?: string | null; scope?: 'session' | 'local' }): CcrEvent {
  return ccrEvent({
    type: 'system',
    subtype: 'model_refusal_fallback',
    trigger: 'refusal',
    direction: 'retry',
    ...(fields.scope ? { scope: fields.scope } : {}),
    original_model: fields.original,
    fallback_model: fields.fallback,
    request_id: 'req_011CTrefusal',
    api_refusal_category: fields.category ?? null,
    api_refusal_explanation: null,
    ...(fields.refused !== undefined ? { refused_user_message_uuid: fields.refused } : {}),
    ...(fields.parent !== undefined ? { parent_tool_use_id: fields.parent } : {}),
    content: `Opus 5's safety measures flagged this message. Switched to Sonnet 5.`
  })
}

export function refusalNoFallback(fields: { original: string; category?: string | null; refused?: string | null }): CcrEvent {
  return ccrEvent({
    type: 'system',
    subtype: 'model_refusal_no_fallback',
    original_model: fields.original,
    request_id: 'req_011CTrefusal2',
    api_refusal_category: fields.category ?? null,
    api_refusal_explanation: null,
    ...(fields.refused !== undefined ? { refused_user_message_uuid: fields.refused } : {}),
    content: ''
  })
}

export function promptSuggestion(suggestion: unknown, extra: Record<string, unknown> = {}): CcrEvent {
  return ccrEvent({ type: 'prompt_suggestion', suggestion, ...extra })
}

export function toolUseSummary(summary: unknown, ids: unknown): CcrEvent {
  return ccrEvent({ type: 'tool_use_summary', summary, preceding_tool_use_ids: ids })
}

export function filesMissing(messageUuid: string | null, missing: unknown, extra: Record<string, unknown> = {}): CcrEvent {
  return ccrEvent({ type: 'system', subtype: 'file_attachments_missing', ...(messageUuid !== null ? { message_uuid: messageUuid } : {}), sent_count: 2, missing, ...extra })
}

export function toolCalls(uuid: string, calls: { id: string; name: string; input: Record<string, unknown> }[]): CcrEvent {
  return ccrEvent({
    type: 'assistant',
    uuid,
    parent_tool_use_id: null,
    message: { role: 'assistant', model: 'claude-opus-5', content: calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })) }
  })
}

export function toolResults(uuid: string, ids: string[]): CcrEvent {
  return ccrEvent({
    type: 'user',
    uuid,
    parent_tool_use_id: null,
    message: { role: 'user', content: ids.map((id) => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })) }
  })
}

export function result(): CcrEvent {
  return ccrEvent({ type: 'result', subtype: 'success', is_error: false })
}

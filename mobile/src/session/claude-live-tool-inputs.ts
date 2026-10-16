import type { NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'

// How the live tool row reads a tool call's inputs, as the Claude app's JSON helpers do
// (claude-live-tool-row.ts has the decompile lines).

export function unreachable(value: never): never {
  throw new Error(`unhandled case: ${String(value)}`)
}

export function inputsOf(call: NativeChatToolCallBlock): Record<string, unknown> {
  const input = call.input
  return input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
}

/** `xpz.h`: a string input, trimmed, or null when absent, not a string, or blank. */
export function stringInput(map: Record<string, unknown>, key: string): string | null {
  const value = map[key]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** A JSON primitive's content (`d.a()`): a string as it is, a number or boolean written out. */
export function primitiveInput(map: Record<string, unknown>, key: string): string | null {
  const value = map[key]
  if (typeof value === 'string') {
    return value
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : null
}

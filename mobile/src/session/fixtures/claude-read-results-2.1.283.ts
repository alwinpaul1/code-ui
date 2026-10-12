import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NativeChatToolPair } from '../../../../src/shared/native-chat-tool-fold'

// Four real Read calls and their results from the user's session 790eafa8
// (Claude Code 2.1.283 and 2.1.284), read-only off the desk on 2026-10-12.
// Each record is the call's `input`, the result's text exactly as the record
// holds it, and the record's own `toolUseResult.file` line counts, which Orca's
// reader does not pass on (kept here only so a test can say what the phone is
// missing).
//
// - partialYaml: lines 84-98 of a 237-line workflow (`offset` 84, `limit` 15)
// - wholeTypescript: all 242 lines of a source file, 10,269 characters, so
//   Orca's mobile wire cuts it (`orcaMobileWire`)
// - shellOutputFile: a background shell's whole 15-line output file
// - partialMarkdown: lines 716-739 of a 757-line Markdown doc

export type RealRead = {
  claudeCode: string
  input: { file_path: string; offset?: number; limit?: number }
  output: string
  file: { numLines: number; startLine: number; totalLines: number }
}

type Records = Record<'partialYaml' | 'wholeTypescript' | 'shellOutputFile' | 'partialMarkdown', RealRead>

export const REAL_READS = JSON.parse(
  readFileSync(fileURLToPath(new URL('./claude-read-results-2.1.283.json', import.meta.url)), 'utf8')
) as Records

/** Orca's mobile wire on a tool result: 4000 characters, then
 *  "\n… (truncated)" (`clip`, MOBILE_BLOCK_CHAR_CAP, src/main/runtime/rpc/methods/native-chat.ts). */
export function orcaMobileWire(output: string): string {
  return output.length > 4000 ? `${output.slice(0, 4000)}\n… (truncated)` : output
}

/** The record as the phone receives it: a Read call and its result. */
export function readPair(read: RealRead): NativeChatToolPair {
  return {
    call: { type: 'tool-call', name: 'Read', input: read.input },
    result: { type: 'tool-result', output: orcaMobileWire(read.output) }
  }
}

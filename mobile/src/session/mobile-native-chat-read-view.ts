// The Claude app's Read sheet (1.261009.20, `y030`): the file's lines with
// their numbers, "Showing N lines (truncated)" when the sheet holds only part
// of the file, and "Load full file", which asks for the whole file.
//
// What a Read result looks like when it reaches the phone (real records in
// fixtures/claude-read-results-2.1.283.json, Claude Code 2.1.283/2.1.284):
// one line per file line, its number, a tab, the text ("84\t      - name: …").
// Only that shape is read: no other numbering was found in this machine's
// transcripts, and a shape the phone has not seen is left as plain output.
// Two things make it partial:
//
// - The call asked for part of the file: an `offset` past the first line, or
//   a `limit` the result filled. Claude Code's record says how many lines the
//   file has (`toolUseResult.file.totalLines`), but Orca's reader keeps only
//   the result text, so the phone never has that total.
// - Orca's mobile wire keeps 4000 characters of a tool result and ends a cut
//   one with "\n… (truncated)" (`MOBILE_BLOCK_CHAR_CAP`,
//   src/main/runtime/rpc/methods/native-chat.ts). The cut lands mid-line, so
//   that last line is dropped: what is drawn is whole lines.
//
// Anything else (an image read, an empty file's notice, a Codex read, which is
// a command and its output) is not a numbered listing and is left to the
// sheet's plain Output box. A listing whose numbers skip is refused too.

import { toolCallKind } from './mobile-native-chat-tool-kind'

export type ReadViewLine = { number: number; text: string }

export type ReadView = {
  lines: ReadViewLine[]
  /** The file holds more than these lines, as far as the phone can tell. */
  truncated: boolean
}

/** What Orca's mobile wire appends to a tool result it cut. */
export const ORCA_WIRE_CUT_MARK = '\n… (truncated)'

/** Lines the viewer draws, loaded or not. Past this a phone Text grows into
 *  the hundreds of kilobytes, which stalls the UI thread. */
export const READ_VIEW_LINE_CAP = 2000
/** Characters of one line the viewer draws. */
export const READ_VIEW_LINE_CHAR_CAP = 2000

const NUMBERED_LINE = /^(\d+)\t(.*)$/
const TRAILING_REMINDER = /\n*<system-reminder>[\s\S]*?<\/system-reminder>\s*$/

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function readRecord(input: unknown): Record<string, unknown> | null {
  let value = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      return null
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function clipLine(text: string): string {
  return text.length > READ_VIEW_LINE_CHAR_CAP ? `${text.slice(0, READ_VIEW_LINE_CHAR_CAP)}…` : text
}

/** The numbered listing of a Claude Read call's result, or null when the
 *  result is not one. */
export function readViewOf(call: { name: string; input: unknown }, output: string, isError = false): ReadView | null {
  if (isError || toolCallKind(call.name) !== 'read' || call.name.trim().toLowerCase() !== 'read') {
    return null
  }
  let body = output
  const cut = body.endsWith(ORCA_WIRE_CUT_MARK)
  if (cut) {
    body = body.slice(0, -ORCA_WIRE_CUT_MARK.length)
  }
  body = body.replace(TRAILING_REMINDER, '')
  const raw = body.split('\n')
  if (cut) {
    // The cut ended this line wherever 4000 characters fell.
    raw.pop()
  } else if (raw.length > 1 && raw.at(-1) === '') {
    raw.pop()
  }
  const lines: ReadViewLine[] = []
  for (const line of raw) {
    const match = NUMBERED_LINE.exec(line)
    if (!match) {
      return null
    }
    const number = Number(match[1])
    const previous = lines.at(-1)
    if (previous && number !== previous.number + 1) {
      return null
    }
    lines.push({ number, text: clipLine(match[2]!) })
  }
  if (lines.length === 0) {
    return null
  }
  const record = readRecord(call.input)
  const offset = positiveInteger(record?.offset)
  const limit = positiveInteger(record?.limit)
  const startsLate = lines[0]!.number > 1 || (offset !== null && offset > 1)
  const filledLimit = limit !== null && lines.length >= limit
  return { lines: lines.slice(0, READ_VIEW_LINE_CAP), truncated: cut || startsLate || filledLimit || lines.length > READ_VIEW_LINE_CAP }
}

/** A whole file the host sent, as the viewer's lines, numbered from 1. */
export function readViewOfFile(content: string, hostCut: boolean): ReadView & { total: number } {
  const raw = content.split('\n')
  if (raw.length > 1 && raw.at(-1) === '') {
    raw.pop()
  }
  const lines = raw.slice(0, READ_VIEW_LINE_CAP).map((text, index) => ({ number: index + 1, text: clipLine(text) }))
  return { lines, total: raw.length, truncated: hostCut || raw.length > READ_VIEW_LINE_CAP }
}

/** The line under the viewer, as the Claude app words it. `total` is known
 *  only for a file the phone loaded whole. */
export function readViewCaption(shown: number, total: number | null): string {
  return total !== null && total > shown
    ? `Showing ${shown} of ${total} lines (truncated)`
    : `Showing ${shown} line${shown === 1 ? '' : 's'} (truncated)`
}

/** The listing's text without its numbers, for the Markdown render. */
export function readViewText(lines: readonly ReadViewLine[]): string {
  return lines.map((line) => line.text).join('\n')
}

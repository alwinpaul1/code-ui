import type { NativeChatBlock, NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { foldMobileNativeChatMessages } from '../mobile-native-chat-render-data'
import { splitTurnIntoSegments } from '../mobile-native-chat-turn-segments'
import WIRE_ROWS from './claude-edit-runs-wire-2.1.282.json'

// Two runs the Claude app draws as "Created a file, ran a command +93 −0" and
// "Edited a file, ran a command +14 −2" (user report and screenshot,
// 2026-09-26), as Code UI receives them over the relay.
//
// The records are Claude Code 2.1.282's, session 76ba8f2f, lines 4407-4457 of
// `~/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/`, read
// 2026-09-26 for their structure only: the same record and key sets, the
// same toolUseResult shapes (a create's `structuredPatch: []` and
// `originalFile: null`; the edit's one resolved hunk, 19,12 → 19,24, its rows
// in the same order: 3 context, 11 added, 1 context, 1 removed, 1 added,
// 4 context, 1 removed, 2 added, 2 context), the same path lengths (88, 74),
// the same Write content size (93 lines, 6111 characters) and the same result
// wording. Every word is neutral. Those records went through Orca origin/main
// 8d6fec597b's own Claude decoder (transcript-line-decoders-claude.ts) and its
// mobile payload diet (native-chat-rpc-block-sanitize.ts, the same 4000-char
// cap as the installed Orca 1.4.211), and the JSON beside this file is what
// came out, untouched. The diet cut the Write's content to 3896 characters
// and appended `… (truncated)`, exactly as it cut the real one.
export const CLAUDE_EDIT_RUN_ROWS = WIRE_ROWS as unknown as NativeChatMessage[]

/** The runs of tool work the chat draws, in order: the create, then the edit. */
function toolRuns(rows: NativeChatMessage[]): NativeChatBlock[][] {
  return foldMobileNativeChatMessages(rows).flatMap((message) =>
    splitTurnIntoSegments(message.blocks)
      .filter((segment) => segment.kind === 'tools')
      .map((segment) => segment.blocks)
  )
}

const [createRun, editRun] = toolRuns(CLAUDE_EDIT_RUN_ROWS)

/** Write (a new file, 93 lines, its content cut on the wire), then Bash. */
export const CREATED_A_FILE_RUN: NativeChatBlock[] = createRun!
/** Edit (resolved hunk: 14 added, 2 removed), then Bash. */
export const EDITED_A_FILE_RUN: NativeChatBlock[] = editRun!

/** A file the create above could have made, for the tests that read it back:
 *  the lines the wire kept and the rest of its 93 lines in the same pattern.
 *  The real file ran to 6111 characters, and the part past the cut is on no
 *  wire, so this one is shorter; it has the same line count and starts with
 *  every character the wire kept. */
export const CREATED_FILE_ON_DISK = `${[
  '#!/bin/bash',
  ...Array.from(
    { length: 92 },
    (_, i) =>
      `echo "sample step ${String(i + 2).padStart(2, '0')} of 93: prepare the neutral sweep input"`
  )
].join('\n')}\n`

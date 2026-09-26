// A command the user runs with `!` is no tool call: Claude Code writes it as a
// plain user turn, `<bash-input>…</bash-input>`, and its output as the next
// one. Orca passes both to the phone as text (its Claude decoder drops only
// meta, synthetic and compact-summary turns, Orca ac675ded6e), so a `!`
// command that wrote a cut create's file was invisible to the count, which
// read only tool calls. Review of 2026-09-26.
//
// The turns are verbatim in shape from this machine's transcripts: 136 `!`
// commands, Claude Code 2.1.228 to 2.1.282, raw (not XML-escaped), one turn
// each, the output turn right after. A `!` command can go to the background
// the way a Bash call does, with the same sentence inside `<bash-stdout>`
// (13 of them, 2.1.247 to 2.1.263), and its finish is the same
// <task-notification>.

import { describe, expect, it } from 'vitest'
import type {
  NativeChatBlock,
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { cutCreateOf, cutCreateStandings } from './mobile-native-chat-created-file-count'
import { MOBILE_CUT } from './mobile-native-chat-edit-wire-cut'
import { CREATED_A_FILE_RUN } from './fixtures/claude-edit-runs-2.1.282'

const WRITE = CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock
const WRITE_RESULT = CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
const KEY = cutCreateOf(WRITE, WRITE_RESULT)!.key
const RELATIVE = 'hybrid-model/scripts/cluster/jobs/queue-sweep-k-one.sh'
const SHELL_ID = 'biggpppx0'

// Claude Code 2.1.247 and 2.1.263, as the `!` command's own output turn.
const MOVED_TO_BACKGROUND = `<bash-stdout>Command did not complete within its 120s timeout and was moved to the background (ID: ${SHELL_ID}). Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-NexDash-NexOS/2feadf63-7890-4b50-a2bc-c0d621411327/tasks/${SHELL_ID}.output. You will be notified when it completes. To check interim output, use Read on that file path.</bash-stdout><bash-stderr></bash-stderr>`
const USER_BACKGROUNDED = `<bash-stdout>Command was manually backgrounded by user with ID: ${SHELL_ID}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-NexDash-NexOS/7a20b64b-74c6-40f1-9d4b-b5080db52831/tasks/${SHELL_ID}.output.</bash-stdout><bash-stderr></bash-stderr>`
const NO_OUTPUT = '<bash-stdout></bash-stdout><bash-stderr></bash-stderr>'

const finished = `<task-notification>
<task-id>${SHELL_ID}</task-id>
<tool-use-id>toolu_01MYrD6JLqm1Z39124tyRFCy</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-NexDash-NexOS/2feadf63-7890-4b50-a2bc-c0d621411327/tasks/${SHELL_ID}.output</output-file>
<status>completed</status>
<summary>Background command "npm run sweep" completed (exit code 0)</summary>
</task-notification>`

let nextId = 0

function message(role: 'assistant' | 'user', blocks: NativeChatBlock[]): NativeChatMessage {
  nextId += 1
  return { id: `m-${nextId}`, role, blocks, timestamp: null, source: 'transcript' }
}

function said(text: string, role: 'assistant' | 'user' = 'user'): NativeChatMessage {
  return message(role, [{ type: 'text', text }])
}

/** A `!` command and the turn that answers it. */
function ran(command: string, output = NO_OUTPUT): NativeChatMessage[] {
  return [said(`<bash-input>${command}</bash-input>`), said(output)]
}

const CREATE = [message('assistant', [WRITE]), message('user', [WRITE_RESULT])]

function touched(messages: NativeChatMessage[]): boolean | undefined {
  return cutCreateStandings(messages).get(KEY)?.touched
}

describe("a command the user ran with '!'", () => {
  it.each([
    ['appends to the file by its relative path', `echo '# tuned' >> ${RELATIVE}`],
    ['edits it in place by its name', "sed -i '' 's/step 03/step 3b/' queue-sweep-k-one.sh"],
    ['moves another file over it', `mv /tmp/queue.sh ${RELATIVE}`]
  ])('draws no count once a command after the create %s', (_, command) => {
    expect(touched([...CREATE, ...ran(command)])).toBe(true)
  })

  it('draws no count once a command after the create is one the wire cut', () => {
    const cut = [
      said(`<bash-input>python3 - <<'EOF'\n${'x = 1\n'.repeat(4)}\n${MOBILE_CUT}`),
      said(NO_OUTPUT)
    ]
    expect(touched([...CREATE, ...cut])).toBe(true)
  })

  it.each([
    ['moved to the background at its timeout', MOVED_TO_BACKGROUND],
    ['the user backgrounded', USER_BACKGROUNDED]
  ])('draws no count for a create made while a command %s was still running', (_, output) => {
    expect(touched([...ran('npm run sweep', output), ...CREATE])).toBe(true)
  })

  it('still counts a create made after the backgrounded command reported', () => {
    expect(touched([...ran('npm run sweep', MOVED_TO_BACKGROUND), said(finished), ...CREATE])).toBe(
      false
    )
  })

  it('still counts a create after a command that names another file', () => {
    expect(touched([...CREATE, ...ran('npm test -- sweep.test.ts')])).toBe(false)
  })

  it('still counts a create whose command came before it', () => {
    expect(touched([...ran(`rm -f ${RELATIVE}`), ...CREATE])).toBe(false)
  })

  it("still counts a create when only the agent's own reply quotes a command", () => {
    const quoted = said(
      `You ran <bash-input>echo x >> ${RELATIVE}</bash-input> earlier.`,
      'assistant'
    )
    expect(touched([...CREATE, quoted])).toBe(false)
  })

  it('still counts a create after an empty command', () => {
    expect(touched([...CREATE, ...ran('')])).toBe(false)
  })
})

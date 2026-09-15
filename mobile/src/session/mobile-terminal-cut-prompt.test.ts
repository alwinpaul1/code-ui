import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

// Real rows from a live pr-919 session (Claude Code 2.1.270), read at the
// PHONE's terminal width on 2026-09-15. The host paints the same prompt wrapped
// across two rows; narrow, Claude truncates it to one row and marks the cut with
// an ellipsis.
//
// The symptom on the device: the prompt appeared as a bubble reading "…utilise
// the entire spac…", sitting directly above the NEXT prompt with the agent's
// whole reply missing between them. A cut row is not the message — it is a
// prefix of it — so it can never match the transcript row it belongs to, which
// means it can never retire. It stays on screen as a duplicate, at the tail,
// forever.
//
// This parser's own rule (CLAUDE.md, "Agent screen parsing"): prefer refusing
// over guessing. A truncated reading is a guess.
const CUT_PROMPT = [
  '❯ the driver name and the parked stats looks similar so near driver name have a small driver icon and utilise the entire spac…',
  '  ⎿ [Image #167]',
  '',
  '  Now I can see it. Reading row 1’s structure:',
  '',
  '  Ran 2 shell commands',
  '',
  '❯ also the parked and other status thing to look better on that',
  '',
  '  Edited 2 files',
  '',
  '❯ '
]

describe('a prompt the phone’s terminal was too narrow to print', () => {
  it('does not offer the truncated prefix as the message', () => {
    const prompts = sentPromptsFromScreen(CUT_PROMPT)
    expect(prompts.some((prompt) => prompt.includes('utilise the entire spac'))).toBe(false)
    expect(prompts.some((prompt) => prompt.endsWith('…'))).toBe(false)
  })

  it('still reads the prompts below it', () => {
    // The cut one used to end the scan of the whole screen, so every later
    // prompt was lost with it.
    expect(sentPromptsFromScreen(CUT_PROMPT)).toEqual([
      'also the parked and other status thing to look better on that'
    ])
  })

  it('never reads the agent’s reply as more of the cut prompt', () => {
    const prompts = sentPromptsFromScreen(CUT_PROMPT)
    expect(prompts.some((prompt) => prompt.includes('Now I can see it'))).toBe(false)
    expect(prompts.some((prompt) => prompt.includes('Ran 2 shell commands'))).toBe(false)
  })

  it('leaves an untruncated prompt alone', () => {
    expect(
      sentPromptsFromScreen(['❯ a prompt that fit on one row', '', '  Ran 1 shell command', '❯ '])
    ).toEqual(['a prompt that fit on one row'])
  })

  it('reads nothing at all from a screen that is only a cut prompt', () => {
    expect(sentPromptsFromScreen(['❯ one very long message that got cut…', '❯ '])).toEqual([])
  })
})

// REMOVED 2026-09-15, with the continuation gathering they pinned:
//
//   reads a prompt that wrapped rather than being cut
//
// The reader takes the `❯` row and nothing under it. Those rows are shaped
// exactly like the agent's own prose — two spaces, then words — and nothing
// visible tells them apart, which is how replies ended up inside user bubbles.
// A wrapped prompt now comes back as its first row, a prefix of the real
// message, and retirement gives way to the transcript row when it lands.
// The contract is pinned in mobile-terminal-single-row-prompts.test.ts.

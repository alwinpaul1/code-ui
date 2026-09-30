import { describe, expect, it } from 'vitest'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import { readLaunch, truncate } from './mobile-background-task-transcript'

// A title is cut at 60 UTF-16 code units (59 and an ellipsis). An emoji is two
// of them, and a cut between the two leaves half a character, which the sheet
// draws as a broken glyph or a replacement box just before the "…".
const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const ROCKET = '🚀'
const T0 = Date.parse('2026-09-30T10:00:00.000Z')

// Verbatim shapes of Claude Code's own launch results (see mobile-background-tasks.test.ts).
const SHELL_STARTED =
  'Command running in background with ID: b7rk2m9xq. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/69c622ea-9120-4353-b0dc-6a198bcf5ceb/tasks/b7rk2m9xq.output. You will be notified when it completes. To check interim output, use Read on that file path.'
const AGENT_LAUNCHED =
  "Async agent launched successfully.\nagentId: a4f1c0d2e9b8a7f6 (internal ID - do not mention to user. Use SendMessage with to: 'a4f1c0d2e9b8a7f6', summary: '<5-10 word recap>' to continue this agent.)"

function shellTitle(description: string): string | undefined {
  return readLaunch(
    { name: 'Bash', input: { command: 'sleep 600', description, run_in_background: true }, startedAt: T0 },
    SHELL_STARTED
  )?.title
}

describe('a background task title with an emoji at the 60-character cap', () => {
  it('keeps a rocket emoji whole on the shell card when it straddles the cut', () => {
    const title = shellTitle(`${'a'.repeat(58)}${ROCKET} then the rest of the description`)
    expect(title).not.toMatch(LONE_HALF)
    expect(title).toBe(`${'a'.repeat(58)}…`)
  })

  it('keeps a rocket emoji whole on a launched agent row when it straddles the cut', () => {
    const title = readLaunch(
      { name: 'Agent', input: { description: `${'b'.repeat(58)}${ROCKET} review the parser` }, startedAt: T0 },
      AGENT_LAUNCHED
    )?.title
    expect(title).not.toMatch(LONE_HALF)
    expect(title).toBe(`${'b'.repeat(58)}…`)
  })

  it('keeps a rocket emoji whole on a roster-only agent row when it straddles the cut', () => {
    const { running } = deriveBackgroundTasks([], T0 + 60_000, {
      state: 'working',
      subagents: [
        {
          id: 'a0c3e5f7b9d1e2f4',
          description: `${'c'.repeat(58)}${ROCKET} sweep the notification copy`,
          state: 'working',
          startedAt: T0
        }
      ]
    })
    expect(running.map((task) => task.title)).toEqual([`${'c'.repeat(58)}…`])
  })

  it('keeps an emoji that ends just before the cut, and cuts after it', () => {
    expect(truncate(`${'a'.repeat(57)}${ROCKET} tail`)).toBe(`${'a'.repeat(57)}${ROCKET}…`)
  })

  it('shows a title of exactly 60 code units whole, emoji included', () => {
    const exact = `${'a'.repeat(58)}${ROCKET}`
    expect(exact).toHaveLength(60)
    expect(truncate(exact)).toBe(exact)
  })

  it('cuts a title one code unit over the cap, whether or not the emoji straddles the cut', () => {
    expect(truncate(`${'a'.repeat(59)}${ROCKET}`)).toBe(`${'a'.repeat(59)}…`)
    const straddling = truncate(`${'a'.repeat(58)}${ROCKET}b`)
    expect(straddling).not.toMatch(LONE_HALF)
    expect(straddling).toBe(`${'a'.repeat(58)}…`)
  })

  it('leaves an empty title and a one-character emoji title alone', () => {
    expect(truncate('')).toBe('')
    expect(truncate(ROCKET)).toBe(ROCKET)
  })

  it('cuts a title made only of emoji between two of them, never through one', () => {
    const title = truncate(ROCKET.repeat(40))
    expect(title).not.toMatch(LONE_HALF)
    expect(title).toBe(`${ROCKET.repeat(29)}…`)
  })
})

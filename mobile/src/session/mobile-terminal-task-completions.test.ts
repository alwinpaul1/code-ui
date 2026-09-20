import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { taskCompletionsFromScreen } from './mobile-terminal-task-completions'

// `tmux capture-pane -p -S -300` of Claude Code 2.1.278 at 46 columns,
// 2026-09-20, after one passing and one failing background shell reported:
//
//     ⏺ Background command "Short nap for a capture"
//     completed (exit code 0)
//
//     ⏺ Background command "A failing nap for a
//     capture" failed with exit code 1
//
// The continuation row sits at COLUMN 0, unlike the agent's prose and an
// accepted prompt, whose wrapped rows are indented two spaces. The first cut
// of this parser assumed the two-space shape and would have read neither.
const screen = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-task-completions-2.1.278.txt', import.meta.url)),
  'utf8'
).split('\n')

describe('completion rows Claude Code paints when a background shell reports', () => {
  it('reads the two rows of the real screen, wrapped at 46 columns, with their labels and outcomes', () => {
    expect(taskCompletionsFromScreen(screen)).toEqual([
      { label: 'Short nap for a capture', status: 'completed' },
      { label: 'A failing nap for a capture', status: 'failed' }
    ])
  })

  it('reads a row that fits on one line', () => {
    expect(taskCompletionsFromScreen(['⏺ Background command "sleep 3" completed (exit code 0)'])).toEqual([
      { label: 'sleep 3', status: 'completed' }
    ])
  })

  it('reads the two stopped shapes', () => {
    expect(
      taskCompletionsFromScreen([
        '⏺ Background command "watch it" was stopped',
        '',
        '⏺ Background command "big build" was stopped',
        'because the system is running low on memory'
      ])
    ).toEqual([
      { label: 'watch it', status: 'stopped' },
      { label: 'big build', status: 'stopped' }
    ])
  })

  it('refuses a row the terminal cut with an ellipsis', () => {
    expect(taskCompletionsFromScreen(['⏺ Background command "A very long description that the…'])).toEqual([])
  })

  it('does not read the agent\'s own prose, a tool row or a prompt as a completion', () => {
    expect(
      taskCompletionsFromScreen([
        '⏺ Both are running in the background',
        '  (bn5kw0qig and bzc40tb41). I\'ll reply once',
        '❯ Background command "typed by me" completed (exit code 0)',
        '  Background command "quoted in prose" completed (exit code 0)',
        '⏺ Bash(sleep 3)'
      ])
    ).toEqual([])
  })

  it('stops gathering at a blank row or a new bullet, so an unfinished row never swallows the next', () => {
    expect(
      taskCompletionsFromScreen([
        '⏺ Background command "never closed',
        '',
        '⏺ Background command "closed" completed (exit code 0)'
      ])
    ).toEqual([{ label: 'closed', status: 'completed' }])
    expect(
      taskCompletionsFromScreen([
        '⏺ Background command "never closed',
        '⏺ Background command "closed" completed (exit code 0)'
      ])
    ).toEqual([{ label: 'closed', status: 'completed' }])
  })

  it('folds a label that wrapped mid-word-run to single spaces', () => {
    expect(
      taskCompletionsFromScreen(['⏺ Background command "A failing nap for a', 'capture" failed with exit code 1'])
    ).toEqual([{ label: 'A failing nap for a capture', status: 'failed' }])
  })

  it('finds nothing on an empty screen or a screen with one row', () => {
    expect(taskCompletionsFromScreen([])).toEqual([])
    expect(taskCompletionsFromScreen(['❯ '])).toEqual([])
  })
})

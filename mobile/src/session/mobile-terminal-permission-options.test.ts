import { describe, expect, it } from 'vitest'
import {
  parseTerminalDialogOptions,
  permissionOptionsFromScreen
} from './mobile-terminal-permission-options'

const BASH_DIALOG = [
  '╭─────────────────────────────────────────────────╮',
  '│ Bash command                                    │',
  '│   rm -rf build                                  │',
  '│   Remove the build directory                    │',
  '│ Do you want to proceed?                         │',
  '│ ❯ 1. Yes                                        │',
  "│   2. Yes, and don't ask again for rm commands in │",
  '│      /Users/alwinpaul/Desktop/Project/Code UI    │',
  '│   3. No, and tell Claude what to do differently  │',
  '│      (esc)                                       │',
  '╰─────────────────────────────────────────────────╯'
].map((line) => line.replace(/^│ ?/, '').replace(/ *│$/, ''))

describe('terminal permission dialog', () => {
  it('reads the numbered options and folds wrapped lines', () => {
    expect(parseTerminalDialogOptions(BASH_DIALOG)).toEqual([
      { digit: '1', text: 'Yes' },
      {
        digit: '2',
        text: "Yes, and don't ask again for rm commands in /Users/alwinpaul/Desktop/Project/Code UI"
      },
      { digit: '3', text: 'No, and tell Claude what to do differently (esc)' }
    ])
  })

  it('maps them to Allow, Allow all and Deny with their real digits', () => {
    expect(permissionOptionsFromScreen(BASH_DIALOG)).toEqual([
      { label: 'Allow', send: '1' },
      { label: 'Allow all', send: '2' },
      { label: 'Deny', send: '3' }
    ])
  })

  it('handles the edit dialog and a two-option dialog', () => {
    expect(
      permissionOptionsFromScreen([
        'Do you want to make this edit to about.tsx?',
        '❯ 1. Yes',
        '  2. Yes, allow all edits during this session (shift+tab)',
        '  3. No, and tell Claude what to do differently (esc)'
      ])
    ).toEqual([
      { label: 'Allow', send: '1' },
      { label: 'Allow all', send: '2' },
      { label: 'Deny', send: '3' }
    ])
    expect(permissionOptionsFromScreen(['❯ 1. Yes', '  2. No'])).toEqual([
      { label: 'Allow', send: '1' },
      { label: 'Deny', send: '2' }
    ])
  })

  it('returns null for a screen without a yes/no dialog', () => {
    expect(permissionOptionsFromScreen(['❯ ', '[Fable 5.1 · effort high] ctx 12%'])).toBeNull()
    expect(permissionOptionsFromScreen(['1. Positional argument', '2. Flag'])).toBeNull()
  })
})

it('skips the "switch to auto mode" choice on a real accept-edits Bash prompt', () => {
  // Captured from Claude Code via `orca terminal read --screen` on 2026-09-05.
  const lines = [
    ' Bash command',
    ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
    '   touch /tmp/codeui-perm-test',
    '   Create empty test file',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. Yes, and always allow access to /private/tmp from this project',
    '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
    '   4. No',
    ' Esc to cancel · Tab to amend',
  ]
  expect(permissionOptionsFromScreen(lines)).toEqual([
    { label: 'Allow', send: '1' },
    { label: 'Allow all', send: '2' },
    { label: 'Deny', send: '4' },
  ])
})

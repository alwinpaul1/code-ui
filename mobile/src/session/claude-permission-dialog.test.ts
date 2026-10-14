import { describe, expect, it } from 'vitest'
import { readClaudePermissionDialog } from './claude-permission-dialog'
import { capturedScreen } from './claude-permission-dialog.test-support'

// Claude Code 2.1.299, real frames (fixtures/claude-screen-permission-amend-2.1.299.txt): the
// permission dialog's numbered rows, which row the `❯` is on, whether the footer offers Tab to
// amend, and what the "No" row reads in its amend mode.

describe('reading a Claude Code permission dialog off the screen', () => {
  it('reads a Bash dialog as it opens: four rows, the highlight on 1, Tab to amend offered', () => {
    const dialog = readClaudePermissionDialog(capturedScreen('bash-dialog'))
    expect(dialog?.options.map((option) => [option.digit, option.text])).toEqual([
      ['1', 'Yes'],
      ['2', 'Yes, and always allow access to /tmp from this project'],
      ['3', 'Yes, and switch to auto mode · auto mode handles these prompts for you'],
      ['4', 'No']
    ])
    expect(dialog?.highlighted).toBe('1')
    expect(dialog?.amendable).toBe(true)
  })

  it('finds the highlight on the No row after Down', () => {
    const dialog = readClaudePermissionDialog(capturedScreen('bash-no-highlighted'))
    expect(dialog?.highlighted).toBe('4')
    expect(dialog?.options.at(-1)?.text).toBe('No')
    expect(dialog?.amendable).toBe(true)
  })

  it('reads the No row in its amend mode, where the footer no longer offers Tab', () => {
    const dialog = readClaudePermissionDialog(capturedScreen('bash-no-amend'))
    expect(dialog?.highlighted).toBe('4')
    expect(dialog?.options.at(-1)?.text).toBe('No, and tell Claude what to do differently')
    expect(dialog?.amendable).toBe(false)
  })

  it('reads the words typed into that row after "No, "', () => {
    const dialog = readClaudePermissionDialog(capturedScreen('bash-no-typed'))
    expect(dialog?.options.at(-1)?.text).toBe('No, use the date command instead')
  })

  it('reads a Write dialog, folding the wrapped second option into it', () => {
    const dialog = readClaudePermissionDialog(capturedScreen('write-dialog'))
    expect(dialog?.options.map((option) => option.digit)).toEqual(['1', '2', '3'])
    expect(dialog?.options[1]?.text).toBe(
      'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session; Yes, and always allow access to /tmp, /private/tmp for this session (shift+tab)'
    )
    expect(dialog?.options[2]?.text).toBe('No')
    expect(dialog?.highlighted).toBe('1')
  })

  it('does not take the file the Write dialog shows for options', () => {
    // "  1 hello" is the new file's first line, drawn above the question.
    const dialog = readClaudePermissionDialog(capturedScreen('write-dialog'))
    expect(dialog?.options).toHaveLength(3)
  })

  it('finds the highlight on the Write dialog’s No row, and its amend mode', () => {
    expect(readClaudePermissionDialog(capturedScreen('write-no-highlighted'))?.highlighted).toBe('3')
    const amend = readClaudePermissionDialog(capturedScreen('write-no-amend'))
    expect(amend?.options.at(-1)?.text).toBe('No, and tell Claude what to do differently')
    expect(amend?.amendable).toBe(false)
  })

  it('finds no dialog once the agent has carried on', () => {
    expect(readClaudePermissionDialog(capturedScreen('bash-after-submit'))).toBeNull()
  })

  it('takes the dialog at the bottom, not a quoted one in the conversation above it', () => {
    const quoted = [
      '❯ Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      ' Esc to cancel · Tab to amend',
      ...capturedScreen('bash-no-highlighted')
    ]
    const dialog = readClaudePermissionDialog(quoted)
    expect(dialog?.options).toHaveLength(4)
    expect(dialog?.highlighted).toBe('4')
  })

  // The degenerate sizes.
  it('finds nothing on an empty screen', () => {
    expect(readClaudePermissionDialog([])).toBeNull()
    expect(readClaudePermissionDialog(['', '', ''])).toBeNull()
  })

  it('finds nothing in a footer with no rows over it', () => {
    expect(readClaudePermissionDialog([' Do you want to proceed?', '', ' Esc to cancel'])).toBeNull()
  })

  it('reads a dialog with a single row, the highlight on it', () => {
    const dialog = readClaudePermissionDialog([' Do you want to proceed?', ' ❯ 1. No', '', ' Esc to cancel'])
    expect(dialog?.options).toEqual([{ digit: '1', text: 'No', highlighted: true }])
    expect(dialog?.highlighted).toBe('1')
  })

  it('refuses rows it does not understand between the question and the footer', () => {
    expect(
      readClaudePermissionDialog([
        ' Do you want to proceed?',
        ' ❯ 1. Yes',
        '   something else entirely',
        ' 3. No',
        ' Esc to cancel'
      ])
    ).toBeNull()
  })

  it('reports no highlight when no row carries the marker', () => {
    const dialog = readClaudePermissionDialog([' Do you want to proceed?', '   1. Yes', '   2. No', ' Esc to cancel'])
    expect(dialog?.highlighted).toBeNull()
  })
})

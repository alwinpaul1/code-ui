import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_APP_SHEET_COMMANDS, openClaudeAppCommandSheet, useClaudeAppCommandSheet, type ClaudeAppSheetCommand } from './claude-app-command-sheets'

// Review 2026-10-15: the registry kept ONE opener per command. Chat A mounted and published its
// /workflows sheet, chat B mounted and replaced it, and when B unmounted it deleted the entry, so
// A's typed /workflows fell through to Claude Code as text while A was still on screen. Each
// mount now takes back only its own opener, and the newest live one opens.

function Publisher({ command, open }: { command: ClaudeAppSheetCommand; open: (() => void) | null }): null {
  useClaudeAppCommandSheet(command, open)
  return null
}

const mounted: ReactTestRenderer[] = []
function mount(command: ClaudeAppSheetCommand, open: (() => void) | null): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(<Publisher command={command} open={open} />)
  })
  mounted.push(renderer!)
  return renderer!
}
const unmount = (renderer: ReactTestRenderer) => act(() => renderer.unmount())

afterEach(() => {
  for (const renderer of mounted.splice(0)) {
    act(() => renderer.unmount())
  }
})

describe.each(CLAUDE_APP_SHEET_COMMANDS)('a typed /%s with two chats mounted in turn', (command) => {
  it('still opens the first chat’s sheet after the second chat unmounts', () => {
    const openA = vi.fn()
    const openB = vi.fn()
    mount(command, openA)
    const b = mount(command, openB)
    unmount(b)
    expect(openClaudeAppCommandSheet(command)).toBe(true)
    expect(openA).toHaveBeenCalledTimes(1)
    expect(openB).not.toHaveBeenCalled()
  })

  it('opens the most recently mounted live chat’s sheet while both are mounted', () => {
    const openA = vi.fn()
    const openB = vi.fn()
    mount(command, openA)
    mount(command, openB)
    expect(openClaudeAppCommandSheet(command)).toBe(true)
    expect(openB).toHaveBeenCalledTimes(1)
    expect(openA).not.toHaveBeenCalled()
  })

  it('a re-render that hands the first chat a new opener does not move it ahead of the second', () => {
    const openA = vi.fn()
    const openA2 = vi.fn()
    const openB = vi.fn()
    const a = mount(command, openA)
    const b = mount(command, openB)
    act(() => a.update(<Publisher command={command} open={openA2} />))
    expect(openClaudeAppCommandSheet(command)).toBe(true)
    expect(openB).toHaveBeenCalledTimes(1)
    unmount(b)
    expect(openClaudeAppCommandSheet(command)).toBe(true)
    expect(openA2).toHaveBeenCalledTimes(1)
    expect(openA).not.toHaveBeenCalled()
  })

  it('keeps the second chat’s sheet when the first unmounts', () => {
    const openA = vi.fn()
    const openB = vi.fn()
    const a = mount(command, openA)
    mount(command, openB)
    unmount(a)
    expect(openClaudeAppCommandSheet(command)).toBe(true)
    expect(openB).toHaveBeenCalledTimes(1)
  })

  it('opens nothing, so the command is sent as typed, once every chat has unmounted', () => {
    const a = mount(command, vi.fn())
    const b = mount(command, vi.fn())
    unmount(b)
    unmount(a)
    expect(openClaudeAppCommandSheet(command)).toBe(false)
  })

  it('opens nothing with no opener ever published, or only a null one', () => {
    expect(openClaudeAppCommandSheet(command)).toBe(false)
    mount(command, null)
    expect(openClaudeAppCommandSheet(command)).toBe(false)
  })
})

it('one command’s chats do not touch another command’s opener', () => {
  const open = vi.fn()
  mount('workflows', open)
  unmount(mount('diff', vi.fn()))
  expect(openClaudeAppCommandSheet('workflows')).toBe(true)
  expect(open).toHaveBeenCalledTimes(1)
})

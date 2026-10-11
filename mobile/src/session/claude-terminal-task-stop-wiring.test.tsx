import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { busyScreen } from './fixtures/claude-busy-lead-tasks-2.1.296'
import {
  acquireMobileNativeChatTerminalWrite,
  isMobileNativeChatTerminalWriteInFlight,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { STOP_NO_TARGET, STOP_TERMINAL_BUSY, useClaudeTerminalTaskStop, type ClaudeTerminalTaskStop } from './use-claude-terminal-task-stop'

// The terminal tab's Stop, end to end on the phone side: the hook a terminal Claude tab gets,
// driving Claude Code's Background dialog over the same `terminal.read` / `terminal.send` RPCs a
// send uses, against the real screens of fixtures/claude-busy-lead-tasks-2.1.296.ts; and the joins
// (read from the AST, never a comment) that hand it to the sheet.

const SESSION_DIR = import.meta.dirname

/** A host whose terminal shows the captured screens, moving on each expected key. */
function host(steps: { key: string; screen: string[] }[]) {
  let screen = busyScreen('screen-before-stop-two-shells.txt', { dropBlank: true })
  let next = 0
  const sent: string[] = []
  const client = {
    sendRequest: vi.fn(async (method: string, params: { text?: string }) => {
      if (method === 'terminal.read') {
        return { ok: true, result: { terminal: { source: 'screen', tail: screen } } }
      }
      if (method === 'terminal.send') {
        sent.push(params.text ?? '')
        if (steps[next]?.key === params.text) {
          screen = steps[next]!.screen
          next += 1
        }
        return { ok: true, result: { send: { accepted: true } } }
      }
      return { ok: false, error: { code: 'unknown' } }
    })
  } as unknown as RpcClient
  return { client, sent }
}

describe("a terminal Claude tab's Stop", () => {
  let renderer: ReactTestRenderer | null = null
  let stop: ClaudeTerminalTaskStop | undefined

  beforeEach(() => resetMobileNativeChatTerminalWritesForTests())
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    stop = undefined
  })

  function Probe(props: { client: RpcClient; enabled: boolean }) {
    const handleRef = useRef<string | null>('term-1')
    const deviceTokenRef = useRef<string | null>(null)
    stop = useClaudeTerminalTaskStop({ client: props.client, handleRef, deviceTokenRef, enabled: props.enabled })
    return null
  }

  function mount(client: RpcClient, enabled = true) {
    act(() => {
      renderer = create(createElement(Probe, { client, enabled }))
    })
  }

  it("stops a subagent's shell through Claude's dialog with ↓, Enter, x, Esc and lets the terminal go", async () => {
    const { client, sent } = host([
      { key: '\x1b[B', screen: busyScreen('screen-shells-pill-focused.txt', { dropBlank: true }) },
      { key: '\r', screen: busyScreen('screen-dialog-two-shells-one-agent.txt', { dropBlank: true }) },
      { key: 'x', screen: busyScreen('screen-dialog-after-stop.txt', { dropBlank: true }) },
      { key: '\x1b', screen: busyScreen('screen-after-dialog-closed.txt', { dropBlank: true }) }
    ])
    mount(client)
    const report = vi.fn()
    expect(await stop!('b-agent-shell', report, { kind: 'shell', label: 'sleep 240' })).toBe(true)
    expect(sent).toEqual(['\x1b[B', '\r', 'x', '\x1b'])
    expect(report).not.toHaveBeenCalled()
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(false)
  })

  it('turns a Stop away while a send holds the terminal, and says why', async () => {
    const { client, sent } = host([])
    mount(client)
    acquireMobileNativeChatTerminalWrite('term-1')
    const report = vi.fn()
    expect(await stop!('t', report, { kind: 'shell', label: 'sleep 240' })).toBe(false)
    expect(report).toHaveBeenCalledWith(STOP_TERMINAL_BUSY)
    expect(sent).toEqual([])
  })

  it('says so for a row with nothing to select it by, and sends nothing', async () => {
    const { client, sent } = host([])
    mount(client)
    const report = vi.fn()
    expect(await stop!('t', report)).toBe(false)
    expect(report).toHaveBeenCalledWith(STOP_NO_TARGET)
    expect(sent).toEqual([])
  })

  it("says Claude's own reason when the drive refuses, and lets the terminal go", async () => {
    const { client, sent } = host([])
    // No shells pill on this screen: Claude has no Background dialog to open.
    vi.mocked(client.sendRequest).mockImplementation((async (method: string) =>
      method === 'terminal.read'
        ? { ok: true, result: { terminal: { source: 'screen', tail: busyScreen('screen-footer-no-count.txt') } } }
        : { ok: true, result: { send: { accepted: true } } }) as never)
    mount(client)
    const report = vi.fn()
    expect(await stop!('t', report, { kind: 'agent', label: 'Busy probe slow' })).toBe(false)
    expect(report).toHaveBeenCalledWith(expect.stringContaining("isn't showing its task list"))
    expect(sent).toEqual([])
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(false)
  })

  it('is absent where it does not apply', () => {
    mount(host([]).client, false)
    expect(stop).toBeUndefined()
  })
})

function parse(name: string): ts.SourceFile {
  const path = join(SESSION_DIR, name)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** The source text of every property assignment or call argument named `name`. */
function valuesOf(source: ts.SourceFile, name: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found.push(node.initializer.getText(source))
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const value = node.initializer
      found.push((ts.isJsxExpression(value) && value.expression ? value.expression : value).getText(source))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('the terminal Stop reaches the sheet', () => {
  it('is built for a connected terminal Claude tab only, and is what the tab stops with', () => {
    const controller = parse('use-mobile-native-chat-controller.ts')
    expect(valuesOf(controller, 'enabled')).toContain(
      "!activeChatStructured && activeChatResolution?.agent === 'claude' && connState === 'connected'"
    )
    expect(valuesOf(controller, 'handleNativeChatStopBackgroundTask')).toEqual([
      'activeChatStructured ? structuredNativeChat.stopBackgroundTask : (terminalTaskStop ?? structuredNativeChat.stopBackgroundTask)'
    ])
    expect(valuesOf(controller, 'nativeChatTerminalTaskStop')).toEqual(['terminalTaskStop !== undefined'])
  })

  it('is handed to the chat view by the overlay, with the row target passed through', () => {
    const overlay = parse('MobileNativeChatOverlay.tsx')
    expect(valuesOf(overlay, 'onStopBackgroundTask')).toEqual([
      'controller.nativeChatBackgroundTasks?.supportsTaskStop === true || controller.nativeChatTerminalTaskStop\n            ? stopBackgroundTask\n            : undefined'
    ])
    expect(readFileSync(join(SESSION_DIR, 'MobileNativeChatOverlay.tsx'), 'utf8')).toContain(
      'controller.handleNativeChatStopBackgroundTask(taskId, report, target)'
    )
  })
})

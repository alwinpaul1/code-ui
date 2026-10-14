import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

// The screen read that finds Claude Code's `/context` table (2.1.300, fixtures/claude-context-2.1.300/),
// and the one that finds Codex's `/status` (codex-cli 0.153.4), which paints no table.
const fixture = (name: string): string[] =>
  readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300', name), 'utf8').split('\n')
const TABLE = fixture('context-130-cols.txt')
const CODEX_STATUS = fixture('codex-status-0.153.4.txt')
// The same session a moment before `/context` was typed: Claude Code's idle footer.
const IDLE = [
  '❯ ',
  '──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  ⏸ manual mode on · ? for shortcuts · ← for agents'
]

const screen = (lines: string[]) => ({ ok: true, result: { terminal: { source: 'screen', lines } } })

let renderer: ReactTestRenderer | null = null
let hud: ReturnType<typeof useMobileTerminalHudObservation>
const handleRef = { current: 'terminal' }

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

async function mount(sendRequest: ReturnType<typeof vi.fn>, agent: 'claude' | 'codex' = 'claude'): Promise<void> {
  vi.useFakeTimers()
  const client = { sendRequest } as unknown as RpcClient
  function Harness(): null {
    hud = useMobileTerminalHudObservation({ client, enabled: true, active: true, handleRef, handleKey: 'terminal', agent })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

describe('the /context table, as a screen read returns it', () => {
  it('is returned, flagged as found on the first read, when the chat opens on a screen that shows it', async () => {
    await mount(vi.fn().mockResolvedValue(screen(TABLE)))
    expect(hud.contextReport).toMatchObject({ firstRead: true, report: { usedTokens: 32_800, windowTokens: 1_000_000 } })
  })

  it('is returned as new, not as found, when it appears after the first read', async () => {
    const sendRequest = vi.fn().mockResolvedValueOnce(screen(IDLE)).mockResolvedValue(screen(TABLE))
    await mount(sendRequest)
    expect(hud.contextReport).toBeNull()
    await advance(1_000)
    expect(hud.contextReport).toMatchObject({ firstRead: false, report: { usedTokens: 32_800 } })
  })

  it('goes with the screen: a read after it has scrolled away returns none (the hold is use-held-context-report.ts)', async () => {
    const sendRequest = vi.fn().mockResolvedValueOnce(screen(IDLE)).mockResolvedValueOnce(screen(TABLE)).mockResolvedValue(screen(IDLE))
    await mount(sendRequest)
    await advance(1_000)
    expect(hud.contextReport).not.toBeNull()
    await advance(1_000)
    expect(hud.contextReport).toBeNull()
  })

  it('is none for a half table: its heading has scrolled off', async () => {
    await mount(vi.fn().mockResolvedValue(screen(TABLE.slice(9))))
    expect(hud.contextReport).toBeNull()
  })

  it('is none for Codex, whose /status prints no table', async () => {
    await mount(vi.fn().mockResolvedValue(screen(CODEX_STATUS)), 'codex')
    expect(hud.contextReport).toBeNull()
  })

  it('is none for a Codex tab even over a screen that has the Claude table (Codex tabs read Codex screens only)', async () => {
    await mount(vi.fn().mockResolvedValue(screen(TABLE)), 'codex')
    expect(hud.contextReport).toBeNull()
  })
})

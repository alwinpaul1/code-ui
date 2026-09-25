// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, it } from 'vitest'
import { consumeAgentHudBeacons, getAgentHudBeacon, resetAgentHudBeacons } from './agent-hud-beacon'
import { CLAUDE_HUD_STATUSLINE_SCRIPT } from './agent-hud-launch-args'

/**
 * The beacon is written to the agent's tty by a second process while the
 * agent paints, so the kernel can put it anywhere inside the agent's own
 * write. On 2026-09-25 (phone on 0.9.54, Claude Code 2.1.281 on the desktop)
 * that drew `❯ 2026h` in the desktop composer: Claude's frame was cut after
 * `ESC[?`, the OSC beacon landed there, its ESC aborted the CSI, and xterm.js
 * printed the tail. A private-pty replay with the host's exact `printf`
 * reproduced it, and the reverse: a whole frame landing inside the beacon,
 * which ended the OSC early and drew the rest of its payload as text.
 *
 * These tests render through the xterm.js the desktop draws with
 * (6.1.0-beta.303, the parser Orca's headless model also runs) and splice the
 * bytes the REAL status-line script writes, at every offset.
 */

// happy-dom replaces URL, so the fixture is found by directory, not import.meta.url.
const statusJson = readFileSync(join(__dirname, 'fixtures/claude-statusline-2.1.266.json'), 'utf8')

/** The status-line JSON with a context figure in it, so the payload carries
 *  `used=… win=…` exactly as a working session's does. */
function workingStatusJson(): string {
  const parsed = JSON.parse(statusJson)
  parsed.context_window.current_usage = {
    input_tokens: 12,
    cache_creation_input_tokens: 3000,
    cache_read_input_tokens: 646528,
    output_tokens: 900
  }
  parsed.context_window.used_percentage = 64
  parsed.context_window.remaining_percentage = 36
  return JSON.stringify(parsed)
}

/** What the host's status-line command writes to the agent's tty, byte for byte. */
function realBeacon(): string {
  const tty = join(mkdtempSync(join(tmpdir(), 'cuihud-splice-')), 'pty')
  execFileSync('sh', ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], {
    input: workingStatusJson(),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), CUIHUD_TTY: tty }
  })
  return readFileSync(tty, 'latin1')
}

/** The screen before the frame: Claude's prompt, the cursor parked at the caret. */
const BEFORE = '\u001b[2J\u001b[H❯ '
/** One Claude Code 2.1.281 frame as `r8n` writes it: BSU, the diff patches, the
 *  cursor back to the declared caret, ESU, in a single write. */
const FRAME =
  '\u001b[?2026h\u001b[3;1H\u001b[2K\u001b[38;2;215;119;87m✻\u001b[39m Schlepping… (20m 29s)' +
  '\u001b[1;3H\u001b[?2026l'

async function render(data: string): Promise<{ rows: string[]; x: number; y: number }> {
  const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true })
  try {
    await new Promise<void>((resolve) => terminal.write(data, resolve))
    const buffer = terminal.buffer.active
    const rows: string[] = []
    for (let y = 0; y < 5; y += 1) {
      rows.push(buffer.getLine(y)?.translateToString(true) ?? '')
    }
    return { rows, x: buffer.cursorX, y: buffer.cursorY }
  } finally {
    terminal.dispose()
  }
}

beforeEach(() => {
  resetAgentHudBeacons()
})

describe('a beacon the kernel splices into a Claude frame draws nothing on the desktop', () => {
  it('the old OSC beacon drew the reported 2026h, and the tail of its own payload', async () => {
    // The shapes reproduced on the pty, kept so this file shows what it guards against.
    const osc = '\u001b]7777;CUIHUD1 agent=claude used=649540 win=1000000\u0007'
    const cut = await render(BEFORE + FRAME.slice(0, 3) + osc + FRAME.slice(3))
    expect(cut.rows[0]).toBe('❯ 2026h')
    const payloadCut = osc.indexOf('used=')
    const inside = await render(BEFORE + osc.slice(0, payloadCut) + FRAME + osc.slice(payloadCut))
    expect(inside.rows[0]).toContain('used=649540 win=1000000')
  })

  it('draws the frame exactly as without it when the beacon lands inside the frame, at any offset', async () => {
    const beacon = realBeacon()
    const clean = await render(BEFORE + FRAME)
    expect(clean.rows[0]).toBe('❯ ')
    for (let at = 1; at < FRAME.length; at += 1) {
      const spliced = await render(BEFORE + FRAME.slice(0, at) + beacon + FRAME.slice(at))
      expect(spliced, `beacon at frame offset ${at} (${JSON.stringify(FRAME.slice(0, at))})`).toEqual(
        clean
      )
    }
  })

  it('draws the frame exactly as without it when the frame lands inside the beacon, at any offset', async () => {
    const beacon = realBeacon()
    const clean = await render(BEFORE + FRAME)
    for (let at = 1; at < beacon.length; at += 1) {
      const spliced = await render(BEFORE + beacon.slice(0, at) + FRAME + beacon.slice(at))
      expect(spliced, `frame at beacon offset ${at}`).toEqual(clean)
    }
  })
})

describe('the phone takes the beacon out of a spliced frame and keeps the frame whole', () => {
  it('when the beacon lands inside the frame', () => {
    const beacon = realBeacon()
    for (let at = 1; at < FRAME.length; at += 1) {
      resetAgentHudBeacons()
      const out = consumeAgentHudBeacons('t-in', FRAME.slice(0, at) + beacon + FRAME.slice(at))
      expect(out, `beacon at frame offset ${at}`).toBe(FRAME)
      expect(getAgentHudBeacon('t-in')).toMatchObject({ usedTokens: 649540, windowTokens: 1000000 })
    }
  })

  it('when the frame lands inside the beacon', () => {
    const beacon = realBeacon()
    for (let at = 1; at < beacon.length; at += 1) {
      resetAgentHudBeacons()
      const out = consumeAgentHudBeacons('t-around', beacon.slice(0, at) + FRAME + beacon.slice(at))
      expect(out, `frame at beacon offset ${at}`).toBe(FRAME)
      expect(getAgentHudBeacon('t-around')).toMatchObject({
        usedTokens: 649540,
        windowTokens: 1000000
      })
    }
  })

  it('when the spliced bytes arrive cut into chunks at every boundary', () => {
    const beacon = realBeacon()
    const stream = FRAME.slice(0, 3) + beacon.slice(0, 40) + FRAME.slice(3) + beacon.slice(40)
    for (let cut = 1; cut < stream.length; cut += 1) {
      resetAgentHudBeacons()
      const out =
        consumeAgentHudBeacons('t-chunks', stream.slice(0, cut)) +
        consumeAgentHudBeacons('t-chunks', stream.slice(cut))
      expect(out, `chunk boundary at ${cut}`).toBe(FRAME)
      expect(getAgentHudBeacon('t-chunks')?.usedTokens).toBe(649540)
    }
  })
})

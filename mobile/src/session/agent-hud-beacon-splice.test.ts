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

type Rendered = { rows: string[]; x: number; y: number; modes: string }

/** What the desktop would show, and the modes it is left in: a dropped
 *  `ESC[?2026l` draws nothing but holds the renderer (see below). */
async function render(data: string): Promise<Rendered> {
  const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true })
  try {
    await new Promise<void>((resolve) => terminal.write(data, resolve))
    const buffer = terminal.buffer.active
    const rows: string[] = []
    for (let y = 0; y < 5; y += 1) {
      rows.push(buffer.getLine(y)?.translateToString(true) ?? '')
    }
    return { rows, x: buffer.cursorX, y: buffer.cursorY, modes: JSON.stringify(terminal.modes) }
  } finally {
    terminal.dispose()
  }
}

/** Offsets just after the `ESC[` of a private-mode CSI (`ESC[?…`). There,
 *  xterm.js 6.1's CSI fast path (`EscapeSequenceParser.ts`, the loop after
 *  "CSI fast-path") meets ANY C0 byte, leaves the loop and resumes in
 *  CSI_PARAM instead of CSI_ENTRY, and CSI_PARAM sends the `?` to
 *  CSI_IGNORE: the sequence is dropped. Nothing is drawn, but a dropped ESU
 *  leaves synchronized output on until the next frame's ESU, or the 1 s
 *  timeout. No byte avoids it; the OSC dropped it too and drew the rest. */
function privateCsiEntries(frame: string): Set<number> {
  const offsets = new Set<number>()
  for (let at = 2; at < frame.length; at += 1) {
    if (frame.slice(at - 2, at) === '\u001b[' && '<=>?'.includes(frame[at]!)) {
      offsets.add(at)
    }
  }
  return offsets
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
    const quirk = privateCsiEntries(FRAME)
    // The BSU at the start and the ESU at the end.
    expect([...quirk]).toEqual([2, FRAME.lastIndexOf('\u001b[?2026l') + 2])
    for (let at = 1; at < FRAME.length; at += 1) {
      const spliced = await render(BEFORE + FRAME.slice(0, at) + beacon + FRAME.slice(at))
      const label = `beacon at frame offset ${at} (${JSON.stringify(FRAME.slice(0, at))})`
      if (quirk.has(at)) {
        expect({ ...spliced, modes: '' }, label).toEqual({ ...clean, modes: '' })
      } else {
        expect(spliced, label).toEqual(clean)
      }
    }
  })

  it('leaves synchronized output on when it lands right after the ESU\'s ESC[, drawing nothing', async () => {
    // Pinned so a change in xterm.js's fast path, or in the writer, is seen.
    const beacon = realBeacon()
    const at = FRAME.lastIndexOf('\u001b[?2026l') + 2
    const spliced = await render(BEFORE + FRAME.slice(0, at) + beacon + FRAME.slice(at))
    const clean = await render(BEFORE + FRAME)
    expect(spliced.rows).toEqual(clean.rows)
    expect(JSON.parse(spliced.modes).synchronizedOutputMode).toBe(true)
    expect(JSON.parse(clean.modes).synchronizedOutputMode).toBe(false)
    // The next frame's ESU ends it, as it does on the desktop.
    const next = await render(BEFORE + FRAME.slice(0, at) + beacon + FRAME.slice(at) + FRAME)
    expect(JSON.parse(next.modes).synchronizedOutputMode).toBe(false)
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

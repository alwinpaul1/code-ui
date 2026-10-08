import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readClaudeStartupFrame } from './claude-startup-frame'
import { snapshotRows, startupFrameFromAttachSnapshot } from './claude-startup-frame-snapshot'

// REAL snapshots, not modelled ones. Captured 2026-10-08 against Claude Code 2.1.294
// (`claude --version`), run in a detached tmux pane at 140x40 with `--settings
// '{"tui":"default"}'` (the classic renderer: this machine's own settings choose
// `"tui": "fullscreen"`, which paints into the alternate screen and leaves no
// scrollback at all). The pane's raw bytes (`tmux pipe-pane`) were fed through the
// headless emulator Orca 1.4.222 itself runs (export `D` of
// out/main/chunks/daemon-cgroup-scope-*.js: the bundled @xterm/headless and its patched
// @xterm/addon-serialize, scrollback 5000), and `getSnapshot({ scrollbackRows: 1000 })`
// was written out as the relay builds a mobile attach snapshot (`scrollbackAnsi +
// snapshotAnsi`). Only the remote-control session ids inside zero-width OSC 8 links were
// replaced, at the same length.
//
// What the pane ran: `seq 1 30` at the shell; `claude` (Opus 5.5, medium) then `!seq 1 80`
// and `/exit`; `claude --model sonnet` (whose frame states no effort) and `/exit`; `claude
// --effort high`, a reply that quotes a frame naming Haiku 4.5, and `!seq 1 60`, which
// pushes every frame off the 40-row screen.
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')
const SCROLLED_OFF = fixture('claude-attach-snapshot-2.1.294-scrolled-off.ansi')
// The same bytes up to the third launch: the newest frame is the Sonnet one.
const SECOND_CLAUDE = fixture('claude-attach-snapshot-2.1.294-second-claude.ansi')
// The same bytes, then the emulator resized to 44 columns, as a phone-fitted host reflows it.
const REFLOWED = fixture('claude-attach-snapshot-2.1.294-reflowed-44-cols.ansi')
const AFTER_RESUME = fixture('claude-attach-snapshot-2.1.294-after-resume.ansi')

const OPUS_HIGH = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' }
const SCREEN_ROWS = 40

describe('the attach snapshot gives a hand-typed Claude tab the effort its banner stated', () => {
  it('reads the effort from a banner that has scrolled off the screen but is in the attach snapshot', () => {
    const rows = snapshotRows(SCROLLED_OFF)
    // The host's visible rows hold no frame, which is why the screen poll cannot read it.
    expect(readClaudeStartupFrame(rows.slice(-SCREEN_ROWS))).toBeNull()
    expect(startupFrameFromAttachSnapshot(SCROLLED_OFF)).toEqual(OPUS_HIGH)
  })

  it('reads the newest of two banners (a second claude in the same terminal), and does not borrow the older effort', () => {
    // The older frame says Opus 5.5 with medium effort; the newer Sonnet frame states none.
    expect(startupFrameFromAttachSnapshot(SECOND_CLAUDE)).toEqual({ model: 'claude-sonnet-5-5', label: 'Sonnet 5.5', effort: null })
  })

  it('reads the banner /resume repaints, not the one the resumed conversation quotes', () => {
    // A fourth capture, same build and pane size: `claude --effort low`, `/clear`, then
    // `/resume` into the session above. 2.1.294 repaints its banner on both (the process's
    // own model and effort, which its status line agreed with: "Opus 5.5 low"), and the
    // resumed conversation, with its quoted Haiku frame, is drawn under it.
    expect(startupFrameFromAttachSnapshot(AFTER_RESUME)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'low' })
  })

  it('does not read a banner a reply quotes, even though it is newer than the real one', () => {
    // The reply's copy names Haiku 4.5 with low effort and sits below the real frame.
    expect(snapshotRows(SCROLLED_OFF).some((row) => row.includes('Haiku 4.5 with low effort · Claude Max'))).toBe(true)
    expect(startupFrameFromAttachSnapshot(SCROLLED_OFF)).toEqual(OPUS_HIGH)
  })

  it('does not read a banner printed inside a reply whose ⏺ row sits above it', () => {
    // DERIVED from the real snapshot: its first frame, cut below, with one reply row put
    // above it, as a reply that prints a banner at column 0 paints it. The reader walks up
    // from the header to the ⏺, so the scan must hand it the rows above the header too.
    const rows = SCROLLED_OFF.split('\r\n')
    const header = rows.findIndex((row) => row.includes('Claude\u001b[1CCode'))
    const inReply = [...rows.slice(0, header), '\u001b[38;5;231m⏺\u001b[1C\u001b[0mHere\u001b[1Cit\u001b[1Cis:', '', ...rows.slice(header, header + 6)]
    expect(readClaudeStartupFrame(snapshotRows(rows.slice(0, header + 6).join('\r\n')))).not.toBeNull()
    expect(startupFrameFromAttachSnapshot(inReply.join('\r\n'))).toBeNull()
  })

  it('reads the banner from a snapshot the host reflowed to a phone width', () => {
    expect(startupFrameFromAttachSnapshot(REFLOWED)).toEqual(OPUS_HIGH)
  })

  it('finds no banner in a snapshot that has none', () => {
    const tail = SCROLLED_OFF.split('\r\n').slice(-SCREEN_ROWS).join('\r\n')
    expect(startupFrameFromAttachSnapshot(tail)).toBeNull()
  })

  it('finds nothing in an empty snapshot, or one of a single row', () => {
    expect(startupFrameFromAttachSnapshot('')).toBeNull()
    expect(startupFrameFromAttachSnapshot('\r\n')).toBeNull()
    expect(startupFrameFromAttachSnapshot(SCROLLED_OFF.split('\r\n')[32]!)).toBeNull()
  })

  it('does not throw on a truncated or malformed snapshot', () => {
    // Every cut of the real snapshot, many inside an escape sequence or a UTF-8 run.
    for (let cut = 0; cut <= SCROLLED_OFF.length; cut += 7) {
      expect(() => startupFrameFromAttachSnapshot(SCROLLED_OFF.slice(0, cut))).not.toThrow()
    }
    // A cursor-forward no terminal is wide enough for, a lone ESC, an unterminated OSC.
    for (const junk of ['\u001b[999999999C', '\u001b', '\u001b]8;;https://x', '\u001b[', '\u001b[38;5', '\u0000\u0001\u0006']) {
      expect(() => startupFrameFromAttachSnapshot(`${junk}Claude Code v2.1.294${junk}\r\n${junk}`)).not.toThrow()
    }
    // A snapshot cut right after the newest frame's model row still reads it.
    const rows = SCROLLED_OFF.split('\r\n')
    const modelRow = rows.findIndex((row) => row.includes('high\u001b[1Ceffort'))
    expect(startupFrameFromAttachSnapshot(rows.slice(0, modelRow + 2).join('\r\n'))).toEqual(OPUS_HIGH)
  })

  it('turns the serialized rows back into the rows the screen shows, columns kept', () => {
    const rows = snapshotRows(SCROLLED_OFF)
    // SerializeAddon writes a run of blank cells as `ESC[nC`; the frame's text must still
    // begin at column 11.
    expect(rows[32]).toBe(' ▐▛███▛█   Claude Code v2.1.294')
    expect(rows[33]).toBe('▝▜██████▀  Opus 5.5 with medium effort · Claude Max')
    expect(rows.at(-1)?.trimEnd()).toBe('')
  })

  it('reads the same frame from its header-only scan as from every row', () => {
    for (const snapshot of [SCROLLED_OFF, SECOND_CLAUDE, REFLOWED, AFTER_RESUME]) {
      expect(startupFrameFromAttachSnapshot(snapshot)).toEqual(readClaudeStartupFrame(snapshotRows(snapshot)))
    }
  })
})

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  MAC_HOST_STATE_PROBE_COMMAND,
  UNKNOWN_MAC_HOST_STATE,
  parseMacHostState,
  readMacHostStateMarker
} from './mac-host-state'

/**
 * The screen the probe painted in an 80-column interactive zsh (`zsh -f` in tmux,
 * `tmux capture-pane -p`), macOS 27.0 (26A428) on Apple Silicon, 2026-09-26, on a
 * Mac that was locked with its display asleep. The command line wraps across six rows before
 * the marker. The same capture with the old command read `... display=off` with no
 * `end`, in 737 ms against 628 ms from Enter to marker.
 */
const CAPTURED_SCREEN = [
  `23% printf 'CUIMAC lock=%s mute=%s end\\n' "$(ioreg -w0 -n Root -d1 | grep -c '"C`,
  `GSSessionScreenIsLocked"=Yes')" "$(osascript -l JavaScript -e 'var m="unknown",d`,
  `="unknown";try{var a=Application.currentApplication();a.includeStandardAdditions`,
  `=true;var v=a.getVolumeSettings().outputMuted;m=v===true?"true":v===false?"false`,
  `":"unknown"}catch(e){}try{ObjC.import("CoreGraphics");d=$.CGDisplayIsAsleep($.CG`,
  `MainDisplayID())?"off":"on"}catch(e){}m+" display="+d')"`,
  'CUIMAC lock=1 mute=true display=off end',
  '23%'
]

describe('the Mac state probe command', () => {
  it('asks the three questions this Mac can answer inside the budget', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGSSessionScreenIsLocked')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('getVolumeSettings().outputMuted')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGDisplayIsAsleep')
    // 2026-09-13: with `; exit` the tab was gone before the first screen read, the
    // probe answered unknown, and the sheet offered every row on a Mac that had said
    // nothing of the sort. The probe closes the tab itself after reading.
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toMatch(/exit\s*$/)
  })

  it('cannot be mistaken for its own echo on the screen', () => {
    // The shell paints the command line itself, so the printf format must not
    // match the marker the parser looks for, wrapped or not.
    expect(readMacHostStateMarker([MAC_HOST_STATE_PROBE_COMMAND])).toBeNull()
    expect(readMacHostStateMarker(CAPTURED_SCREEN.slice(0, 6))).toBeNull()
  })

  // 2026-09-26: the check sat on "Checking the Mac…" for the whole command, and the
  // command spent most of its time in two places that answer nothing: plutil
  // parsing 210 KB of XML to find one key, and a second osascript start.
  it('starts osascript once and never parses the registry as XML', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND.match(/osascript/g)).toHaveLength(1)
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('plutil')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('ioreg -n Root -d1 -a')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain(`ioreg -w0 -n Root -d1 | grep -c '"CGSSessionScreenIsLocked"=Yes'`)
  })

  it('carries nothing an interactive shell would rewrite before running it', () => {
    // bash expands `!` on an interactive command line even inside double quotes.
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('!')
  })
})

describe('reading the Mac state off the screen', () => {
  it('reads a locked Mac with its display off, from the screen it really painted', () => {
    expect(parseMacHostState(CAPTURED_SCREEN)).toEqual({
      lock: 'locked',
      display: 'off',
      mute: 'muted'
    })
  })

  // The next three lines are the captured one with each value flipped; this Mac
  // could not be unlocked or woken while it was being measured.
  it('reads an awake, unlocked Mac', () => {
    expect(parseMacHostState(['CUIMAC lock=0 mute=false display=on end'])).toEqual({
      lock: 'unlocked',
      display: 'on',
      mute: 'unmuted'
    })
  })

  it('reads a locked Mac whose display is still on', () => {
    expect(parseMacHostState(['CUIMAC lock=1 mute=false display=on end'])).toEqual({
      lock: 'locked',
      display: 'on',
      mute: 'unmuted'
    })
  })

  it('takes the last marker when the screen still holds an older one', () => {
    expect(
      parseMacHostState(['CUIMAC lock=1 mute=true display=off end', 'CUIMAC lock=0 mute=false display=on end'])
    ).toEqual({ lock: 'unlocked', display: 'on', mute: 'unmuted' })
  })

  it('stays unknown rather than guessing when no marker was painted', () => {
    expect(readMacHostStateMarker([])).toBeNull()
    expect(parseMacHostState([])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['zsh: command not found: ioreg'])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['CUIMAC lock=2 mute=maybe display=dim end'])).toEqual(UNKNOWN_MAC_HOST_STATE)
  })

  it('does not take a line that has not finished painting for an answer', () => {
    expect(readMacHostStateMarker(['CUIMAC lock=1 mute=true display=off'])).toBeNull()
    expect(readMacHostStateMarker(['CUIMAC lock=1 mute=true display=o'])).toBeNull()
    expect(readMacHostStateMarker(['CUIMAC lock=1 mute='])).toBeNull()
  })

  // An output device macOS cannot mute answers `missing value`. The old read printed
  // those words, nothing parsed, and the check waited out its 12 s budget.
  it('reads a Mac whose output device cannot say whether it is muted, instead of waiting it out', () => {
    expect(readMacHostStateMarker(['CUIMAC lock=0 mute=unknown display=on end'])).toEqual({
      lock: 'unlocked',
      display: 'on',
      mute: 'unknown'
    })
  })

  it('keeps the lock answer when osascript printed nothing at all', () => {
    expect(readMacHostStateMarker(['CUIMAC lock=1 mute= end'])).toEqual({
      lock: 'locked',
      display: 'unknown',
      mute: 'unknown'
    })
  })
})

/**
 * Why the display can be asked now and could not before. On 2026-09-14 the only
 * source that answered correctly was `pmset -g log`, which dumps the entire power
 * log — 28 seconds against a 4-second budget — so the probe timed out and lock
 * and mute were lost with it. Both display rows showed on every Mac since.
 *
 * On 2026-09-18 the ioreg candidates were measured across a real display sleep:
 * IOMobileFramebuffer reads CurrentPowerState=1 awake AND asleep, and a full
 * device-tree diff showed no display node changing state within four seconds —
 * only the video decoder, camera and Neural Engine, which is background work.
 * A power-state proxy was never going to say it.
 *
 * CGDisplayIsAsleep is the CoreGraphics call that owns the answer. Reached
 * through JXA, which every Mac ships, it read awake / asleep / awake across the
 * same sleep and took 70 ms.
 */
describe('what the probe is willing to ask', () => {
  it('never reaches for the sources that blew the budget', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('pmset')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('log show')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('IOMobileFramebuffer')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('IODisplayWrangler')
  })

  it('asks CoreGraphics, which owns the answer', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGDisplayIsAsleep($.CGMainDisplayID())')
  })

  // The whole reason: "Wake display" was offered on a Mac whose display was on.
  it('answers display so only the applicable row is offered', () => {
    expect(parseMacHostState(['CUIMAC lock=0 mute=false display=on end']).display).toBe('on')
    expect(parseMacHostState(['CUIMAC lock=0 mute=false display=off end']).display).toBe('off')
  })
})

/**
 * The JavaScript the probe hands osascript, run here against stand-ins for the
 * three things it touches. Node runs the exact text from the command, so these
 * pin what the Mac will print for each answer Standard Additions and CoreGraphics
 * can give, including the ones this Mac cannot produce on demand.
 */
describe('the one osascript the probe starts', () => {
  const script = /osascript -l JavaScript -e '([^']*)'/.exec(MAC_HOST_STATE_PROBE_COMMAND)?.[1] ?? ''

  function runJxa(volumeSettings: () => unknown, displayIsAsleep: () => unknown, importFramework = () => undefined) {
    return runInNewContext(script, {
      Application: {
        currentApplication: () => ({ includeStandardAdditions: false, getVolumeSettings: volumeSettings })
      },
      ObjC: { import: importFramework },
      $: { CGDisplayIsAsleep: displayIsAsleep, CGMainDisplayID: () => 1 }
    }) as string
  }

  it('is found in the command', () => {
    expect(script).toContain('getVolumeSettings')
  })

  it('prints mute and display for a muted Mac whose display is asleep', () => {
    expect(runJxa(() => ({ outputMuted: true }), () => true)).toBe('true display=off')
  })

  it('prints mute and display for an unmuted, awake Mac', () => {
    expect(runJxa(() => ({ outputMuted: false }), () => false)).toBe('false display=on')
  })

  it('prints unknown for an output device that answers missing value', () => {
    expect(runJxa(() => ({ outputMuted: null }), () => false)).toBe('unknown display=on')
    expect(runJxa(() => ({}), () => false)).toBe('unknown display=on')
  })

  it('keeps the display answer when the volume read throws', () => {
    const refuse = () => {
      throw new Error('Standard Additions refused')
    }
    expect(runJxa(refuse, () => true)).toBe('unknown display=off')
  })

  it('keeps the mute answer when CoreGraphics cannot be reached', () => {
    const refuse = () => {
      throw new Error('no CoreGraphics')
    }
    expect(runJxa(() => ({ outputMuted: true }), () => false, refuse)).toBe('true display=unknown')
    expect(runJxa(() => ({ outputMuted: false }), refuse)).toBe('false display=unknown')
  })
})

/**
 * The command itself, run by each shell a Mac user might have, with `ioreg` and
 * `osascript` replaced by scripts that print what the real ones print. This is
 * the shell's quoting and substitution under test, not the Mac: it runs anywhere.
 * The ioreg line is the shape `ioreg -w0 -n Root -d1` printed on 2026-09-26, cut
 * to the keys around the one the probe reads.
 */
describe('the probe command in a real shell', () => {
  const which = (name: string) => ['/bin', '/usr/bin'].map((dir) => join(dir, name)).find((path) => existsSync(path))
  const grep = which('grep')
  const shells = ['sh', 'bash', 'zsh'].flatMap((name) => {
    const path = which(name)
    return path ? [{ name, path }] : []
  })
  const LOCKED_IOREG =
    '      "IOConsoleUsers" = ({"kCGSSessionOnConsoleKey"=Yes,"kCGSSessionUserNameKey"="someone",' +
    '"CGSSessionScreenIsLocked"=Yes,"kCGSSessionAuditIDKey"=100017})'
  const UNLOCKED_IOREG =
    '      "IOConsoleUsers" = ({"kCGSSessionOnConsoleKey"=Yes,"kCGSSessionUserNameKey"="someone",' +
    '"kCGSSessionAuditIDKey"=100017})'

  function runWith(shell: string, stubs: Record<string, string>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'cui-mac-probe-'))
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    }
    symlinkSync(grep!, join(dir, 'grep'))
    return execFileSync(shell, ['-c', MAC_HOST_STATE_PROBE_COMMAND], {
      // Only the stubs and grep on PATH. NODE_ENV because React Native's typings
      // make it required on a process environment.
      env: { PATH: dir, NODE_ENV: 'test' },
      encoding: 'utf8',
      // The failing osascript's complaint lands on the terminal, not in the marker.
      stdio: ['ignore', 'pipe', 'ignore']
    }).split('\n')
  }

  for (const shell of shells) {
    it(`reads lock, mute and display from ${shell.name}`, () => {
      const lines = runWith(shell.path, {
        ioreg: `printf '%s\\n' '${LOCKED_IOREG}'`,
        osascript: `printf '%s\\n' 'false display=on'`
      })
      expect(readMacHostStateMarker(lines)).toEqual({ lock: 'locked', display: 'on', mute: 'unmuted' })
    })

    it(`reads an unlocked Mac, whose session carries no lock key, from ${shell.name}`, () => {
      const lines = runWith(shell.path, {
        ioreg: `printf '%s\\n' '${UNLOCKED_IOREG}'`,
        osascript: `printf '%s\\n' 'true display=off'`
      })
      expect(readMacHostStateMarker(lines)).toEqual({ lock: 'unlocked', display: 'off', mute: 'muted' })
    })

    it(`still answers the lock when osascript fails, from ${shell.name}`, () => {
      const lines = runWith(shell.path, {
        ioreg: `printf '%s\\n' '${LOCKED_IOREG}'`,
        osascript: `echo 'execution error: Not authorized' >&2; exit 1`
      })
      expect(readMacHostStateMarker(lines)).toEqual({ lock: 'locked', display: 'unknown', mute: 'unknown' })
    })

    it(`still answers the lock when this Mac has no osascript, from ${shell.name}`, () => {
      const lines = runWith(shell.path, { ioreg: `printf '%s\\n' '${LOCKED_IOREG}'` })
      expect(readMacHostStateMarker(lines)).toEqual({ lock: 'locked', display: 'unknown', mute: 'unknown' })
    })
  }

  it('found a shell to run in', () => {
    expect(grep).toBeDefined()
    expect(shells.length).toBeGreaterThan(0)
  })
})

// On a Mac, the real command against the real Mac: whatever state it is in, the
// line must parse. Skipped elsewhere (CI runs on Linux).
describe.runIf(process.platform === 'darwin')('the probe command on this Mac', () => {
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    it(`paints a marker the phone can read, from ${shell}`, () => {
      const lines = execFileSync(shell, ['-c', MAC_HOST_STATE_PROBE_COMMAND], { encoding: 'utf8' }).split('\n')
      const state = readMacHostStateMarker(lines)
      expect(state).not.toBeNull()
      expect(state?.lock).not.toBe('unknown')
    })
  }
})

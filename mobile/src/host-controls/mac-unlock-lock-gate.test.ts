import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAC_SCREEN_LOCK_GATE, buildMacUnlockCommand, macUnlockAppleScriptLines } from './mac-host-commands'

/**
 * The review of 2026-09-26: Unlock types forty Deletes, the password and Return
 * as keystrokes into whatever is in front on the Mac. On a Mac that is not locked
 * that is a chat window, a terminal or a browser field, and the password lands in
 * it. So the command itself checks, when it runs, that the screen is locked, and
 * types nothing otherwise.
 *
 * These run the real command in each shell with every tool it calls replaced:
 * `ioreg` prints what the Mac prints, and `osascript` is a stand-in that walks the
 * AppleScript it was handed and writes down what it would have done. It never
 * writes the password down; it says whether the text it would type IS the
 * password. Nothing here types anything on this Mac.
 */

// Obviously not anyone's password.
const FAKE_PASSWORD = 'fake-pw-not-real'

/** The rows `ioreg -w0 -n Root -d1` printed on macOS 27.0 (26A428) on 2026-09-26,
 *  each cut to the keys around the ones the check reads. The Mac was locked. */
function registry(consoleUsers: string | null): string[] {
  return [
    '+-o Root  <class IORegistryEntry, id 0x100000100, retain 37>',
    '    {',
    '      "OS Build Version" = "26A428"',
    '      "IORegistryPlanes" = {"IOPort"="IOPort","IOPower"="IOPower","IOService"="IOService"}',
    '      "IOConsoleLocked" = Yes',
    ...(consoleUsers === null ? [] : [`      "IOConsoleUsers" = (${consoleUsers})`]),
    '      "IOKitDiagnostics" = {"Instance allocation"=41272888}',
    '    }'
  ]
}
const LOCKED_SESSION =
  '{"kCGSSessionOnConsoleKey"=Yes,"kCGSSessionUserNameKey"="someone","CGSSessionScreenIsLocked"=Yes,"kCGSSessionAuditIDKey"=100017}'
// The captured session with the lock key taken out, which is how an unlocked Mac
// reads (mac-host-state.test.ts); this Mac could not be unlocked while measured.
const UNLOCKED_SESSION = '{"kCGSSessionOnConsoleKey"=Yes,"kCGSSessionUserNameKey"="someone","kCGSSessionAuditIDKey"=100017}'
// A second user, switched out behind the one on screen, whose own screen is locked.
// Built from the captured shape: this Mac has one user, so nothing to capture.
const SWITCHED_OUT_LOCKED_SESSION =
  '{"kCGSSessionOnConsoleKey"=No,"kCGSSessionUserNameKey"="other","CGSSessionScreenIsLocked"=Yes,"kCGSSessionAuditIDKey"=100018}'

const prints = (rows: string[]) => `printf '%s\\n' ${rows.map((row) => `'${row}'`).join(' ')}`
const LOCKED = prints(registry(LOCKED_SESSION))
const UNLOCKED = prints(registry(UNLOCKED_SESSION))

/** Walks the AppleScript lines the way osascript would run them, for the lines the
 *  unlock command uses, and writes one word per step to the log. */
const OSASCRIPT_STUB = `#!${process.execPath}
const { appendFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const log = (entry) => appendFileSync(process.env.CUI_LOG, entry + '\\n')
const argv = process.argv.slice(2)
const lines = []
for (let i = 0; i < argv.length; i += 1) if (argv[i] === '-e') lines.push(argv[++i] ?? '')
log('osascript')
const literal = (text) => text.replace(/\\\\(["\\\\])/g, '$1')
let lock = ''
for (const line of lines) {
  let m
  if (line === 'key code 51') log('clear')
  else if ((m = /^set cuiLock to do shell script "(.*)"$/.exec(line))) {
    lock = execFileSync(process.env.CUI_SHELL, ['-c', literal(m[1])], { encoding: 'utf8' }).replace(/\\n$/, '')
    log('recheck ' + lock)
  } else if (line === 'if cuiLock is not "locked" then return cuiLock') {
    if (lock !== 'locked') { process.stdout.write(lock + '\\n'); process.exit(0) }
  } else if ((m = /^keystroke "(.*)"$/.exec(line))) {
    log(literal(m[1]) === process.env.CUI_EXPECTED ? 'type the password' : 'type something else')
  } else if (line === 'keystroke return') log('return')
  else if ((m = /^return "(.*)"$/.exec(line))) { process.stdout.write(m[1] + '\\n'); process.exit(0) }
}
`

const which = (name: string) => ['/bin', '/usr/bin'].map((dir) => join(dir, name)).find((path) => existsSync(path))
const grep = which('grep')
const tr = which('tr')
const shells = ['sh', 'bash', 'zsh', 'dash'].flatMap((name) => {
  const path = which(name)
  return path ? [{ name, path }] : []
})

/** `ioreg` answers in order, one per call, the last repeating; 'none' means the Mac has no ioreg. */
function runUnlock(shell: string, ioreg: string[] | 'none', password = FAKE_PASSWORD) {
  const dir = mkdtempSync(join(tmpdir(), 'cui-mac-unlock-'))
  const logPath = join(dir, 'calls.log')
  writeFileSync(logPath, '')
  const stub = (name: string, body: string) => writeFileSync(join(dir, name), body, { mode: 0o755 })
  stub('caffeinate', `#!/bin/sh\necho caffeinate >> '${logPath}'\n`)
  stub('sleep', `#!/bin/sh\necho sleep >> '${logPath}'\n`)
  stub('osascript', OSASCRIPT_STUB)
  if (ioreg !== 'none') {
    const arms = ioreg.map((answer, index) => `${index + 1}) ${answer} ;;`).join(' ')
    stub(
      'ioreg',
      `#!/bin/sh\necho ioreg >> '${logPath}'\nn=0\n[ -f '${dir}/n' ] && read n < '${dir}/n'\n` +
        `n=$((n + 1))\necho "$n" > '${dir}/n'\ncase $n in ${arms} *) ${ioreg.at(-1)} ;; esac\n`
    )
  }
  symlinkSync(grep!, join(dir, 'grep'))
  symlinkSync(tr!, join(dir, 'tr'))
  const stdout = execFileSync(shell, ['-c', buildMacUnlockCommand(password)], {
    // NODE_ENV because React Native's typings make it required on a process environment.
    env: { PATH: dir, NODE_ENV: 'test', CUI_LOG: logPath, CUI_SHELL: shell, CUI_EXPECTED: password },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const log = readFileSync(logPath, 'utf8')
  return { lines: stdout.split('\n'), calls: log.split('\n').filter(Boolean), everything: stdout + log }
}

describe('the unlock command in a real shell', () => {
  for (const shell of shells) {
    it(`types nothing, and says the Mac is not locked, when ioreg says it is unlocked, from ${shell.name}`, () => {
      const run = runUnlock(shell.path, [UNLOCKED])
      expect(run.calls).toEqual(['caffeinate', 'sleep', 'ioreg'])
      expect(run.lines).toContain('CUIREFUSED unlocked')
      expect(run.lines).not.toContain('CUIDONE ok')
      expect(run.everything).not.toContain(FAKE_PASSWORD)
    })

    it(`types nothing, and says it could not tell, when ioreg fails, from ${shell.name}`, () => {
      // Even a locked answer does not count from an ioreg that then failed.
      for (const failing of [`echo 'ioreg: no registry' >&2; exit 1`, `${LOCKED}; exit 1`]) {
        const run = runUnlock(shell.path, [failing])
        expect(run.calls).toEqual(['caffeinate', 'sleep', 'ioreg'])
        expect(run.lines).toContain('CUIREFUSED unconfirmed')
        expect(run.lines).not.toContain('CUIDONE ok')
        expect(run.everything).not.toContain(FAKE_PASSWORD)
      }
    })

    it(`types nothing on a Mac with no ioreg, or with no one on its console, from ${shell.name}`, () => {
      for (const ioreg of ['none', [prints(registry(null))], [prints(registry('()'))]] as const) {
        const run = runUnlock(shell.path, ioreg === 'none' ? 'none' : [...ioreg])
        expect(run.calls.filter((call) => call !== 'ioreg')).toEqual(['caffeinate', 'sleep'])
        expect(run.lines).toContain('CUIREFUSED unconfirmed')
        expect(run.everything).not.toContain(FAKE_PASSWORD)
      }
    })

    it(`types nothing when the locked screen is another user's, switched out behind the one on screen, from ${shell.name}`, () => {
      for (const users of [
        `${SWITCHED_OUT_LOCKED_SESSION},${UNLOCKED_SESSION}`,
        `${UNLOCKED_SESSION},${SWITCHED_OUT_LOCKED_SESSION}`
      ]) {
        const run = runUnlock(shell.path, [prints(registry(users))])
        expect(run.calls).toEqual(['caffeinate', 'sleep', 'ioreg'])
        expect(run.lines).toContain('CUIREFUSED unlocked')
      }
    })

    it(`types the password once, checking the lock straight before it, when ioreg says locked, from ${shell.name}`, () => {
      const run = runUnlock(shell.path, [LOCKED])
      // The check comes after the wake and the wait, not before them, and again
      // after the field is cleared, just before the password.
      expect(run.calls).toEqual([
        'caffeinate',
        'sleep',
        'ioreg',
        'osascript',
        'clear',
        'ioreg',
        'recheck locked',
        'type the password',
        'return'
      ])
      expect(run.lines).toContain('CUIDONE ok')
      expect(run.lines.some((line) => line.startsWith('CUIREFUSED'))).toBe(false)
      expect(run.everything).not.toContain(FAKE_PASSWORD)
    })

    // A Watch or Touch ID can let the user in after the first check: the wake this
    // command does is what asks for it.
    it(`does not type the password when the Mac unlocks between the check and the keystroke, from ${shell.name}`, () => {
      const run = runUnlock(shell.path, [LOCKED, UNLOCKED])
      expect(run.calls).toEqual(['caffeinate', 'sleep', 'ioreg', 'osascript', 'clear', 'ioreg', 'recheck unlocked'])
      expect(run.lines).toContain('CUIREFUSED unlocked')
      expect(run.lines).not.toContain('CUIDONE ok')
      expect(run.everything).not.toContain(FAKE_PASSWORD)
    })

    it(`hands osascript the password exactly, quotes, backslashes and all, from ${shell.name}`, () => {
      for (const password of [`a"b`, 'a\\b', "a'b", 'a$b`c', `it's "a\\ test"`]) {
        const run = runUnlock(shell.path, [LOCKED], password)
        expect(run.calls).toContain('type the password')
        expect(run.calls).not.toContain('type something else')
      }
    })
  }

  it('found a shell to run in', () => {
    expect(grep).toBeDefined()
    expect(tr).toBeDefined()
    expect(shells.length).toBeGreaterThan(0)
  })
})

// On a Mac, the real check against the real registry. It only reads: ioreg, and an
// osascript handed the check's lines and none that type. Skipped elsewhere.
describe.runIf(process.platform === 'darwin')('the lock check on this Mac', () => {
  const answersOnThisMac = () =>
    ['/bin/sh', '/bin/zsh', '/bin/bash', '/bin/dash']
      .filter((shell) => existsSync(shell))
      .map((shell) => execFileSync(shell, ['-c', MAC_SCREEN_LOCK_GATE], { encoding: 'utf8' }))

  it('reads the real registry as locked or unlocked, never as "could not tell"', () => {
    const answers = answersOnThisMac()
    expect(answers.length).toBeGreaterThan(0)
    expect(['locked', 'unlocked']).toContain(answers[0])
    expect(new Set(answers).size).toBe(1)
  })

  it('gives AppleScript the same answer the shell gets', () => {
    const answers = answersOnThisMac()
    // Only lines named here run, so a line added later that types is never among them.
    const checkOnly = macUnlockAppleScriptLines(FAKE_PASSWORD).filter((line) =>
      /^(set cuiLock to do shell script "|if cuiLock is not "locked" then return cuiLock$|return "typed"$)/.test(line)
    )
    expect(checkOnly).toHaveLength(3)
    expect(checkOnly.join('\n')).not.toMatch(/System Events|keystroke|key code/)
    expect(checkOnly.join('\n')).not.toContain(FAKE_PASSWORD)
    const result = execFileSync('/usr/bin/osascript', checkOnly.flatMap((line) => ['-e', line]), {
      encoding: 'utf8'
    }).trim()
    expect(result).toBe(answers[0] === 'locked' ? 'typed' : answers[0])

    // This Mac cannot be unlocked while it is measured, so the other answers come from
    // a stand-in check; the lines after it are the real ones.
    for (const word of ['unlocked', 'unconfirmed', 'locked']) {
      const script = [`set cuiLock to do shell script "printf ${word}"`, ...checkOnly.slice(1)]
      const answer = execFileSync('/usr/bin/osascript', script.flatMap((line) => ['-e', line]), { encoding: 'utf8' })
      expect(answer.trim()).toBe(word === 'locked' ? 'typed' : word)
    }
  })
})

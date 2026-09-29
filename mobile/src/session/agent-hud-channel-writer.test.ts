import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeAgentHudChannelText, encodeAgentHudChannelFrame } from './agent-hud-channel'
import { AGENT_HUD_TTY_WRITE } from './agent-hud-tty-write'

/** The shells Claude Code and Codex hand the writer to: macOS `sh` is bash 3.2
 *  in POSIX mode, `bash` whatever is on PATH, and dash where it exists (Debian's
 *  /bin/sh, and shipped with macOS). */
const SHELLS: readonly string[] = ['sh', 'bash', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])]

/** Runs only the tty writer, with `$1` as the payload, and returns the bytes it wrote. */
function write(shell: string, payload: string): string {
  const tty = join(mkdtempSync(join(tmpdir(), 'cuihud-writer-')), 'pty')
  execFileSync(shell, ['-c', `o="$1"; ${AGENT_HUD_TTY_WRITE.join('; ')}`, 'sh', payload], {
    // Only these variables, on purpose. The cast is for Expo's ProcessEnv, which demands NODE_ENV.
    env: { PATH: process.env.PATH ?? '', CUIHUD_TTY: tty } as unknown as NodeJS.ProcessEnv
  })
  return readFileSync(tty, 'latin1')
}

describe('the host writer and the phone reader agree on every byte', () => {
  it('writes a prompt of any script and length as one frame the phone decodes back', () => {
    // UTF-8 past ASCII, and a payload long enough that `tr` writes it in
    // several chunks: the frame is one stream of channel bytes either way.
    const text = `déjà vu, 日本語, ${'x'.repeat(6000)}`
    for (const shell of SHELLS) {
      const raw = write(shell, text)
      expect(raw, shell).toBe(encodeAgentHudChannelFrame(text))
      expect(decodeAgentHudChannelText(raw), shell).toEqual([text])
    }
  })

  it('writes the one-byte payload, the smallest a frame carries', () => {
    for (const shell of SHELLS) {
      expect(write(shell, 'x'), shell).toBe(encodeAgentHudChannelFrame('x'))
    }
  })
})

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// scripts/run-detached.mjs double-forks, so a command it runs has an ancestor
// chain that ends at pid 1 with no terminal in it. This runs the real runner and
// has the command READ its own ancestry with the real `ps` (no write anywhere).
const RUNNER = join(__dirname, 'run-detached.mjs')
const REAL_PS = ['/bin/ps', '/usr/bin/ps'].find((path) => existsSync(path))!
const WALK = `p=$$; n=0; while [ -n "$p" ] && [ "$p" != 1 ] && [ $n -lt 8 ]; do echo "$p tty=$(${REAL_PS} -o tty= -p $p | tr -d ' ')"; p=$(${REAL_PS} -o ppid= -p $p | tr -d ' '); n=$((n+1)); done; echo "end=$p"`

const run = (args: string[]) => spawnSync('node', [RUNNER, ...args], { encoding: 'utf8', timeout: 60_000 })

describe('the detached runner', () => {
  it('runs a command whose ancestors end at pid 1 and hold no terminal', () => {
    const r = run(['sh', '-c', WALK])
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines.at(-1)).toBe('end=1')
    const ttys = lines.filter((line) => line.includes('tty=')).map((line) => line.split('tty=')[1])
    expect(ttys.length).toBeGreaterThan(0)
    expect(ttys.filter((tty) => tty !== '' && !/^\?+$/.test(tty!))).toEqual([])
    // runner → pid 1 means the command's shell sits at most two steps below it.
    expect(lines.length).toBeLessThanOrEqual(4)
  })

  it('relays the command’s stdout and stderr and exits with its status', () => {
    const r = run(['sh', '-c', 'echo out; echo err >&2; exit 7'])
    expect(r.stdout).toBe('out\n')
    expect(r.stderr).toBe('err\n')
    expect(r.status).toBe(7)
  })

  it('exits non-zero for a command that cannot start, and for none given', () => {
    expect(run(['/no/such/command-xyz']).status).not.toBe(0)
    expect(run([]).status).not.toBe(0)
  })

  it('gives the command no stdin', () => {
    const r = run(['sh', '-c', 'cat; echo done'])
    expect(r.stdout).toBe('done\n')
  })

  it('is how `pnpm test` runs vitest, and the release workflow runs `pnpm test`', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.test).toBe('node scripts/run-detached.mjs vitest run')
    const workflow = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'mobile-android-release.yml'), 'utf8')
    expect(workflow.split('\n').filter((line) => !line.trimStart().startsWith('#')).some((line) => /^\s*(?:-\s*)?(?:run:\s*)?pnpm test\s*$/.test(line))).toBe(true)
  })
})

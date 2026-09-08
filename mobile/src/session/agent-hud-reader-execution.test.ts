import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AGENT_HUD_READER_SOURCE } from './agent-hud-reader-source'

// Records captured from a live Claude Code 2.1.263 transcript
// (~/.claude/projects/.../<session>.jsonl), trimmed to the fields the reader
// reads. Real bytes: the shapes below — top-level `effort`, `version`,
// `isSidechain`, and `message.usage` with its four counters — are exactly what
// 2.1.263 writes.
const claudeAssistant = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    timestamp: '2026-09-08T07:01:36.373Z',
    version: '2.1.263',
    gitBranch: 'main',
    cwd: '/w',
    isSidechain: false,
    effort: 'xhigh',
    message: {
      model: 'claude-opus-5',
      role: 'assistant',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 971,
        cache_read_input_tokens: 176864,
        output_tokens: 531
      }
    },
    ...over
  })

// Codex 0.153.4 rollout records, same treatment.
const codexTokenCount = JSON.stringify({
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: { input_tokens: 216441, output_tokens: 865, total_tokens: 217306 },
      model_context_window: 258400
    },
    rate_limits: {
      primary: { used_percent: 33, window_minutes: 43200, resets_at: 1791356964 },
      secondary: null,
      plan_type: 'free'
    }
  }
})
const codexTurnContext = JSON.stringify({
  type: 'turn_context',
  payload: { model: 'gpt-5.6-terra', effort: 'xhigh', approval_policy: 'on-request', cwd: '/w' }
})

function runReader(args: string[], home?: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'hud-reader-'))
  const script = join(dir, 'reader.js')
  writeFileSync(script, AGENT_HUD_READER_SOURCE)
  const out = execFileSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    ...(home ? { env: { ...process.env, HOME: home } } : {})
  })
  // The reader prints the output path first when it was given one; the JSON is
  // the last line either way.
  const lines = out.trim().split('\n')
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>
}

function transcript(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'hud-fixture-'))
  const file = join(dir, 'session.jsonl')
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

it('actually runs, and reports what Claude Code wrote', () => {
  // Every other test in this file asserted on the SOURCE TEXT, which passes
  // even when the call it greps for sits in a dead branch. This one executes
  // the shipped constant, which is the only thing that proves it works.
  const file = transcript([
    JSON.stringify({ type: 'permission-mode', permissionMode: 'auto' }),
    claudeAssistant()
  ])
  const snapshot = runReader(['--agent', 'claude', '--transcript', file])
  expect(snapshot.model).toBe('claude-opus-5')
  expect(snapshot.effort).toBe('xhigh')
  expect(snapshot.agentVersion).toBe('2.1.263')
  expect(snapshot.permissionMode).toBe('auto')
  expect(snapshot.contextUsedTokens).toBe(2 + 971 + 176864)
})

it('reports the main thread, not a subagent running beside it', () => {
  // A subagent runs against its own context; taking its record would show the
  // sidechain's occupancy as the main thread's.
  const file = transcript([
    claudeAssistant(),
    claudeAssistant({
      isSidechain: true,
      message: {
        model: 'claude-haiku-4-5',
        role: 'assistant',
        usage: { input_tokens: 1, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 }
      }
    })
  ])
  const snapshot = runReader(['--agent', 'claude', '--transcript', file])
  expect(snapshot.model).toBe('claude-opus-5')
  expect(snapshot.contextUsedTokens).toBe(2 + 971 + 176864)
})

it('still finds the record when one turn writes more than the first tail window', () => {
  // Measured across the transcripts on this machine, 21% have at least one gap
  // wider than 512 KB — a big tool result, a pasted file, a long diff. A fixed
  // window lost the session exactly when it was busiest, and the HUD blanked.
  const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(700_000) } })
  const file = transcript([claudeAssistant(), filler])
  const snapshot = runReader(['--agent', 'claude', '--transcript', file])
  expect(snapshot.error).toBeUndefined()
  expect(snapshot.model).toBe('claude-opus-5')
})

it('reports a context window with nothing installed on the host', () => {
  // The point of the feature: a Code UI user sets up nothing. Falling back to a
  // status line's cache only works for someone who already installed one, so
  // the size has to come from the session's own numbers — a session cannot have
  // held more tokens than its window. Verified against the live transcript on
  // this machine: 652k used gives 1M both from the cache and from this rule.
  const big = transcript([
    claudeAssistant({
      message: {
        model: 'claude-opus-5',
        role: 'assistant',
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 652_000,
          cache_creation_input_tokens: 15
        }
      }
    })
  ])
  const wide = runReader(['--agent', 'claude', '--transcript', big])
  expect(wide.contextWindowTokens).toBe(1_000_000)
  expect(wide.contextWindowSource).toBe('inferred-from-session')

  // An ordinary session stays on the ordinary window.
  const small = runReader(['--agent', 'claude', '--transcript', transcript([claudeAssistant()])])
  expect(small.contextWindowTokens).toBe(200_000)
})

it('follows a compaction instead of reporting the context it just threw away', () => {
  // The newest assistant record still says what the context held BEFORE the
  // compaction, and the next one only lands when the agent replies. Without
  // this the ring sits red at 93% for the whole gap, when the truth is 2%.
  const file = transcript([
    claudeAssistant({
      message: {
        model: 'claude-opus-5',
        role: 'assistant',
        usage: { input_tokens: 1, cache_read_input_tokens: 928_000, cache_creation_input_tokens: 0 }
      }
    }),
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2026-09-08T07:10:00.000Z',
      compactMetadata: { trigger: 'auto', preTokens: 928_282, postTokens: 20_208 }
    })
  ])
  const snapshot = runReader(['--agent', 'claude', '--transcript', file])
  expect(snapshot.contextUsedTokens).toBe(20_208)
  // And the compaction point is itself the best evidence of the window.
  expect(snapshot.contextWindowTokens).toBe(1_000_000)
})

/** A fake $HOME holding one Codex rollout, laid out the way codex-cli 0.153.4
 *  does: ~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<threadId>.jsonl. */
function codexHome(sessionId: string, lines: string[], cwd = '/w'): string {
  const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const dir = join(home, '.codex', 'sessions', '2026', '09', '06')
  mkdirSync(dir, { recursive: true })
  const meta = JSON.stringify({
    type: 'session_meta',
    payload: { session_id: sessionId, cwd, cli_version: '0.153.4', originator: 'codex-tui' }
  })
  writeFileSync(
    join(dir, `rollout-2026-09-06T12-10-00-${sessionId}.jsonl`),
    `${[meta, ...lines].join('\n')}\n`
  )
  return home
}

it('reports what Codex wrote, including the window it was told', () => {
  const home = codexHome('01a07632', [codexTurnContext, codexTokenCount])
  const snapshot = runReader(['--agent', 'codex', '--session', '01a07632'], home)
  expect(snapshot.error).toBeUndefined()
  expect(snapshot.model).toBe('gpt-5.6-terra')
  expect(snapshot.effort).toBe('xhigh')
  expect(snapshot.approvalPolicy).toBe('on-request')
  // Codex reports its own window, so no inference is needed for it.
  expect(snapshot.contextUsedTokens).toBe(217306)
  expect(snapshot.contextWindowTokens).toBe(258400)
  expect(snapshot.contextWindowSource).toBe('reported-by-agent')
  expect(snapshot.planType).toBe('free')
  expect(snapshot.primaryLimit).toEqual({
    usedPercent: 33,
    windowMinutes: 43200,
    resetsAt: 1791356964
  })
})

it('finds the Codex session by cwd when no session id is known', () => {
  const home = codexHome('01a07632', [codexTurnContext, codexTokenCount], '/projects/code-ui')
  const found = runReader(['--agent', 'codex', '--cwd', '/projects/code-ui'], home)
  expect(found.model).toBe('gpt-5.6-terra')
  // A different directory is somebody else's session, so it must refuse rather
  // than hand back the newest rollout it happens to see.
  const other = runReader(['--agent', 'codex', '--cwd', '/projects/other'], home)
  expect(other.error).toBe('no-rollout')
})

it('refuses a Codex session id it cannot find instead of guessing', () => {
  const home = codexHome('01a07632', [codexTurnContext, codexTokenCount])
  expect(runReader(['--agent', 'codex', '--session', 'nope'], home).error).toBe('no-rollout')
})

it('never throws, whatever it is pointed at', () => {
  expect(runReader(['--agent', 'claude', '--transcript', '/does/not/exist']).error).toBe(
    'no-assistant-record'
  )
  const junk = transcript(['not json', '{"type":"assistant"}', ''])
  expect(runReader(['--agent', 'claude', '--transcript', junk]).error).toBe('no-assistant-record')
})

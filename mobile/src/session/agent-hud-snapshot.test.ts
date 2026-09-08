import { expect, it } from 'vitest'
import {
  agentHudContextPercent,
  buildAgentHudSnapshotCommand,
  parseAgentHudSnapshot,
  readAgentHudSnapshot,
  shellQuote
} from './agent-hud-snapshot'

// Printed by the reader against a live session, Claude Code 2.1.263.
const CLAUDE_JSON = JSON.stringify({
  agent: 'claude',
  model: 'claude-opus-5',
  effort: 'xhigh',
  agentVersion: '2.1.263',
  contextUsedTokens: 507540,
  contextPeakTokens: 507540,
  contextWindowTokens: 1000000,
  contextWindowSource: 'statusline-cache',
  permissionMode: 'auto',
  outputTokens: 1221,
  at: '2026-09-08T06:56:33.987Z',
  readerVersion: 1
})

// Printed by the reader against a live rollout, codex-cli 0.153.4.
const CODEX_JSON = JSON.stringify({
  agent: 'codex',
  rolloutPath: '/Users/x/.codex/sessions/2026/09/06/rollout-2026-09-06T12-10-00-01a07632.jsonl',
  model: 'gpt-5.6-terra',
  effort: 'xhigh',
  approvalPolicy: 'on-request',
  contextUsedTokens: 217306,
  contextWindowTokens: 258400,
  contextWindowSource: 'reported-by-agent',
  planType: 'free',
  primaryLimit: { usedPercent: 33, windowMinutes: 43200, resetsAt: 1791356964 },
  secondaryLimit: null,
  readerVersion: 1
})

it('reads a Claude snapshot the way the agent wrote it', () => {
  const snapshot = parseAgentHudSnapshot(CLAUDE_JSON)!
  expect(snapshot.agent).toBe('claude')
  expect(snapshot.model).toBe('claude-opus-5')
  expect(snapshot.effort).toBe('xhigh')
  expect(snapshot.agentVersion).toBe('2.1.263')
  expect(snapshot.mode).toBe('auto')
  expect(agentHudContextPercent(snapshot)).toBe(51)
})

it('reads a Codex snapshot including the limits the agent was told', () => {
  const snapshot = parseAgentHudSnapshot(CODEX_JSON)!
  expect(snapshot.agent).toBe('codex')
  expect(snapshot.model).toBe('gpt-5.6-terra')
  expect(snapshot.mode).toBe('on-request')
  expect(snapshot.planType).toBe('free')
  expect(agentHudContextPercent(snapshot)).toBe(84)
  expect(snapshot.limits).toEqual([
    { usedPercent: 33, windowMinutes: 43200, resetsAt: 1791356964 }
  ])
})

it('shows no percentage rather than a guessed one when the window is unknown', () => {
  // Claude Code never records the window size and a 1M session logs an unmarked
  // `claude-opus-5`. Naming a size would read as 99% full for a window half
  // full, which is worse than showing the token count alone.
  const snapshot = parseAgentHudSnapshot(
    JSON.stringify({
      agent: 'claude',
      model: 'claude-opus-5',
      contextUsedTokens: 507540,
      contextWindowTokens: null,
      contextWindowSource: 'unknown'
    })
  )!
  expect(snapshot.contextUsedTokens).toBe(507540)
  expect(snapshot.contextWindowTokens).toBeNull()
  expect(agentHudContextPercent(snapshot)).toBeNull()
})

it('survives a reader that could not read anything', () => {
  const snapshot = parseAgentHudSnapshot(JSON.stringify({ agent: 'codex', error: 'no-rollout' }))!
  expect(snapshot.error).toBe('no-rollout')
  expect(snapshot.model).toBeNull()
  expect(agentHudContextPercent(snapshot)).toBeNull()
  expect(parseAgentHudSnapshot('not json at all')).toBeNull()
  expect(parseAgentHudSnapshot(JSON.stringify({ agent: 'gemini' }))).toBeNull()
})

it('quotes a path a shell would otherwise take apart', () => {
  expect(shellQuote("/tmp/it's here/a b.jsonl")).toBe(`'/tmp/it'\\''s here/a b.jsonl'`)
  expect(shellQuote('/tmp/$(rm -rf ~)/x')).toBe(`'/tmp/$(rm -rf ~)/x'`)
})

it('names an absolute output path the phone can ask the host to read back', () => {
  // The phone has to name this path to the host, so it cannot be a shell
  // variable the host would expand and the phone could not.
  const built = buildAgentHudSnapshotCommand({
    target: { agent: 'claude', transcriptPath: '/Users/x/.claude/projects/p/s.jsonl' },
    id: 'abc123',
    readerBase64: 'QUJD'
  })
  expect(built.outPath).toBe('/tmp/orca-hud-abc123.json')
  expect(built.command).not.toContain('TMPDIR')
  expect(built.command).toContain('QUJD')
  expect(built.command).toContain(`--transcript '/Users/x/.claude/projects/p/s.jsonl'`)
  // Nothing is written to the host but the JSON result: the reader goes into
  // node's stdin, never onto disk as a file.
  expect(built.command).toContain('| node - ')
  expect(built.command).not.toMatch(/orca-hud-abc123\.js\b/)
  expect(built.command).toContain(`--out '/tmp/orca-hud-abc123.json'`)
  // The shell exits on its own, so the tab closes even if the phone loses the
  // connection before it can close it.
  expect(built.command.trimEnd().endsWith('exit')).toBe(true)
})

it('passes Codex its session id when known and the cwd when not', () => {
  const byId = buildAgentHudSnapshotCommand({
    target: { agent: 'codex', sessionId: '01a07632', cwd: '/w' },
    id: 'i',
    readerBase64: 'QQ=='
  })
  expect(byId.command).toContain(`--session '01a07632'`)
  expect(byId.command).toContain(`--cwd '/w'`)
  const byCwd = buildAgentHudSnapshotCommand({
    target: { agent: 'codex', cwd: '/w' },
    id: 'i',
    readerBase64: 'QQ=='
  })
  expect(byCwd.command).not.toContain('--session')
  expect(byCwd.command).toContain(`--cwd '/w'`)
})

it('embeds the reader byte for byte', async () => {
  // The reader is shipped as a template literal. Escaping it with String.raw
  // once left every backslash doubled and every backtick as the six characters
  // of its escape: the script still ran, still exited 0, and reported every
  // transcript empty, because its line split had become a split on "\\n".
  const { AGENT_HUD_READER_SOURCE } = await import('./agent-hud-reader-source')
  expect(AGENT_HUD_READER_SOURCE.startsWith("'use strict'")).toBe(true)
  // The source holds the two characters backslash-n, not a real newline.
  expect(AGENT_HUD_READER_SOURCE).toContain("text.split('\\n')")
  expect(AGENT_HUD_READER_SOURCE).not.toContain('\\\\n')
  expect(AGENT_HUD_READER_SOURCE).not.toContain('\\u0060')
  // The two facts the whole feature rests on.
  expect(AGENT_HUD_READER_SOURCE).toContain('model_context_window')
  expect(AGENT_HUD_READER_SOURCE).toContain('cache_read_input_tokens')
})

function fakeClient(responses: Record<string, unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  return {
    calls,
    sendRequest: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      return responses[method] ?? { ok: false }
    }
  }
}

it('spawns, reads the file back, and always closes the shell it made', async () => {
  const client = fakeClient({
    'terminal.create': { ok: true, result: { terminal: 'hud-1' } },
    'files.resolveTerminalPath': {
      ok: true,
      result: {
        worktree: 'wt-1',
        openTarget: {
          kind: 'absolute-file',
          absolutePath: '/tmp/orca-hud-x.json',
          grantId: 'grant-1'
        }
      }
    },
    'files.readTerminalArtifact': { ok: true, result: { content: CODEX_JSON } },
    'terminal.wait': { ok: true, result: { wait: 'exit' } },
    'terminal.close': { ok: true, result: {} }
  })
  const snapshot = await readAgentHudSnapshot({
    client,
    worktree: 'id:wt-1',
    target: { agent: 'codex', cwd: '/w' },
    id: 'x',
    readerBase64: 'QQ=='
  })
  expect(snapshot?.model).toBe('gpt-5.6-terra')
  // terminal.create returns when the terminal EXISTS, not when its command has
  // run, and the grant pins the file's identity — so the wait is what makes the
  // read deterministic instead of a race the link speed decides.
  expect(client.calls.map((call) => call.method)).toEqual([
    'terminal.create',
    'terminal.wait',
    'files.resolveTerminalPath',
    'files.readTerminalArtifact',
    'terminal.close'
  ])
  expect(client.calls[1]?.params.for).toBe('exit')
  expect(client.calls[2]?.params.pathText).toBe('/tmp/orca-hud-x.json')
  expect(client.calls[0]?.params.presentation).toBe('background')
})

it('closes the shell even when the read fails, and reports nothing rather than guessing', async () => {
  const client = fakeClient({
    'terminal.create': { ok: true, result: { terminal: 'hud-2' } },
    'terminal.wait': { ok: true, result: { wait: 'exit' } },
    'files.resolveTerminalPath': { ok: false },
    'terminal.close': { ok: true, result: {} }
  })
  const snapshot = await readAgentHudSnapshot({
    client,
    worktree: 'id:wt-1',
    target: { agent: 'claude', transcriptPath: '/t.jsonl' },
    id: 'y',
    readerBase64: 'QQ=='
  })
  expect(snapshot).toBeNull()
  expect(client.calls.some((call) => call.method === 'terminal.close')).toBe(true)
})

it('makes no terminal at all when the host refuses to create one', async () => {
  const client = fakeClient({ 'terminal.create': { ok: false } })
  const snapshot = await readAgentHudSnapshot({
    client,
    worktree: 'id:wt-1',
    target: { agent: 'claude', transcriptPath: '/t.jsonl' },
    id: 'z',
    readerBase64: 'QQ=='
  })
  expect(snapshot).toBeNull()
  expect(client.calls.map((call) => call.method)).toEqual(['terminal.create'])
})

it('refuses an id that could carry shell syntax', () => {
  // The id is the one value interpolated into the command unquoted.
  expect(() =>
    buildAgentHudSnapshotCommand({
      target: { agent: 'claude', transcriptPath: '/t.jsonl' },
      id: "x'; rm -rf /tmp; echo '",
      readerBase64: 'QQ=='
    })
  ).toThrow('alphanumeric')
})

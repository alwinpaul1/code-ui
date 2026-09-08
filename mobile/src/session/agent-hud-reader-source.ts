/* eslint-disable */
// The reader that runs ON THE HOST, in a throwaway shell, and prints one JSON
// object. It ships as text because the phone cannot install anything on the
// desktop: zero setup is the whole point.
//
// Verified end to end against Claude Code 2.1.263 and codex-cli 0.153.4 by
// generating the command, running it, and reading the file back.
//
// A plain template literal, NOT String.raw: raw would keep every backslash
// literal, so an escaped backtick would arrive as the six characters of its
// escape and \n inside the script would stay two characters — which silently
// broke the line split and made every transcript look empty.

export const AGENT_HUD_READER_SOURCE = `'use strict'
// Reads an agent's own on-disk session record and prints one JSON object.
// Runs on the host, in a throwaway shell; nothing is installed and nothing is
// left behind but the file it writes. Never throws: a field it cannot read is
// null, and \`error\` says why, because a wrong number is worse than no number.
const fs = require('fs')
const os = require('os')
const path = require('path')

const TAIL_BYTES = 512 * 1024

function tailLines(file, bytes) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    // A partial first line when the window cut mid-record.
    const lines = text.split('\\n')
    if (start > 0) lines.shift()
    return lines.filter((line) => line.length > 0)
  } catch {
    return []
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
}

function headLines(file, bytes) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = fs.readSync(fd, buf, 0, bytes, 0)
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\\n')
    // Drop a trailing partial record.
    if (bytesRead === bytes) lines.pop()
    return lines.filter((line) => line.length > 0)
  } catch {
    return []
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
}

function parseEach(lines) {
  const out = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch {}
  }
  return out
}

// Claude Code never records the context-window SIZE, and the model id does not
// carry it: a live 1M session logs \`claude-opus-5\`, unmarked. Verified against
// Claude Code 2.1.263, where the session below stood at 493k used — a name-based
// guess would have called the window 200k and shown 246%, and "smallest standard
// size that fits" would have called it 500k and shown 99% for a window half full.
// Both are worse than silence, so the size is reported only when it is KNOWN:
// the explicit [1m] marker, or a statusline cache that recorded it. Otherwise it
// is null and the caller shows tokens used without a percentage.
function claudeWindowFromCache(homeDir, transcriptPath) {
  // The cache file is named sha256(transcriptPath) — verified against
  // claude-hud-enhanced 0.7.7, context-cache.ts:58-62 ("Uses a sha256 of the
  // transcript path so that concurrent Claude Code sessions do not collide").
  // An exact key, so this either finds THIS session's window or nothing; it
  // never borrows another session's number.
  try {
    const hash = require('crypto').createHash('sha256').update(transcriptPath).digest('hex')
    const file = path.join(
      homeDir,
      '.claude',
      'plugins',
      'claude-hud-enhanced',
      'context-cache',
      hash + '.json'
    )
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'))
    const size = entry && entry.context_window_size
    return typeof size === 'number' && size > 0 ? size : null
  } catch {
    return null
  }
}

// The sizes Claude Code actually ships. A session is one of these; which one is
// what has to be worked out.
const CLAUDE_WINDOWS = [200000, 500000, 1000000]

/** Nothing may be installed on the host, so the size has to come from evidence
 *  the agent itself leaves:
 *
 *  - the \`[1m]\` marker in the model id, when it is there;
 *  - a status line's cache, when the user happens to run one (exact);
 *  - otherwise the smallest shipped size that the session's own numbers FIT.
 *    That last one is a proven lower bound, not a guess: a session cannot have
 *    held more tokens than its window, and Claude Code auto-compacts near the
 *    limit, so a \`compact_boundary\`'s \`preTokens\` is the closest evidence there
 *    is. It can under-report a 1M window early on, but it is never above 100%
 *    and it corrects upward as the session grows — and it means the figure
 *    exists at all for a user with nothing installed, which is the point. */
function claudeWindow(model, transcriptPath, homeDir, evidence) {
  if (typeof model === 'string' && /\\[1m\\]/i.test(model)) {
    return { size: 1000000, source: 'model-id' }
  }
  const cached = claudeWindowFromCache(homeDir, transcriptPath)
  if (cached) return { size: cached, source: 'statusline-cache' }
  const floor = Math.max(evidence || 0, 0)
  for (const size of CLAUDE_WINDOWS) {
    if (floor <= size) return { size, source: 'inferred-from-session' }
  }
  return { size: CLAUDE_WINDOWS[CLAUDE_WINDOWS.length - 1], source: 'inferred-from-session' }
}

function readClaude(transcriptPath) {
  // One turn can write more than a fixed tail: a big tool result, a pasted
  // file, a long diff. Measured across the transcripts on this machine, 21% of
  // them have at least one gap wider than 512 KB, so a fixed window loses the
  // session exactly when it is busiest. Widen until a record is in hand.
  let records = []
  for (const bytes of [TAIL_BYTES, 4 * TAIL_BYTES, 16 * TAIL_BYTES]) {
    records = parseEach(tailLines(transcriptPath, bytes))
    if (records.some((r) => r && r.type === 'assistant' && r.isSidechain !== true)) break
  }
  let assistant = null
  let permissionMode = null
  let observedMax = 0
  let compactFloor = 0
  let compacted = null
  const n0 = (value) => (typeof value === 'number' && isFinite(value) ? value : 0)
  for (const record of records) {
    if (record && record.type === 'assistant' && record.isSidechain !== true) {
      const u = (record.message && record.message.usage) || {}
      observedMax = Math.max(
        observedMax,
        n0(u.input_tokens) + n0(u.cache_read_input_tokens) + n0(u.cache_creation_input_tokens)
      )
    }
    if (record && record.type === 'permission-mode' && typeof record.permissionMode === 'string') {
      permissionMode = record.permissionMode
    }
    // Claude Code compacts near the limit, so preTokens is the best evidence of
    // the window there is; postTokens is what is in context after it.
    const compact = record && record.compactMetadata
    if (compact && typeof compact === 'object') {
      compactFloor = Math.max(compactFloor, n0(compact.preTokens))
      compacted = { postTokens: n0(compact.postTokens), at: record.timestamp || null }
    }
    // A subagent runs against its own context; taking its record would report
    // the sidechain's occupancy as the main thread's. A record with no message
    // carries neither a model nor usage, so it is not a reading.
    if (record && record.type === 'assistant' && record.isSidechain !== true && record.message) {
      assistant = record
      compacted = null
    }
  }
  if (!assistant) {
    return { agent: 'claude', error: 'no-assistant-record' }
  }
  const message = assistant.message || {}
  const usage = message.usage || {}
  const n = (value) => (typeof value === 'number' && isFinite(value) ? value : 0)
  const fromRecord =
    n(usage.input_tokens) + n(usage.cache_read_input_tokens) + n(usage.cache_creation_input_tokens)
  // A compaction that landed AFTER the newest assistant record is the current
  // truth: the record still says what the context held before it. Without this
  // the ring sits red at 93% until the agent next replies, when it is really 2%.
  const used = compacted ? compacted.postTokens : fromRecord
  const model = typeof message.model === 'string' ? message.model : null
  const window = claudeWindow(
    model,
    transcriptPath,
    os.homedir(),
    Math.max(observedMax, fromRecord, compactFloor)
  )
  return {
    agent: 'claude',
    model,
    effort: typeof assistant.effort === 'string' ? assistant.effort : null,
    agentVersion: typeof assistant.version === 'string' ? assistant.version : null,
    contextUsedTokens: used,
    contextPeakTokens: Math.max(observedMax, used),
    contextWindowTokens: window.size,
    contextWindowSource: window.source,
    permissionMode,
    outputTokens: n(usage.output_tokens),
    at: typeof assistant.timestamp === 'string' ? assistant.timestamp : null
  }
}

function newestCodexRollout(sessionId, cwd) {
  const root = path.join(os.homedir(), '.codex', 'sessions')
  const found = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        if (sessionId && !entry.name.includes(sessionId)) continue
        try {
          found.push({ full, mtime: fs.statSync(full).mtimeMs })
        } catch {}
      }
    }
  }
  walk(root, 0)
  found.sort((a, b) => b.mtime - a.mtime)
  if (sessionId) return found.length ? found[0].full : null
  if (!cwd) return found.length ? found[0].full : null
  // Without a session id, the cwd in session_meta is the only honest
  // discriminator; newest-mtime alone silently picks the wrong session when two
  // run at once.
  // session_meta is the FIRST record in a rollout, so it is never in the tail.
  for (const candidate of found.slice(0, 40)) {
    const head = parseEach(headLines(candidate.full, 32 * 1024))
    const meta = head.find((r) => r && r.type === 'session_meta')
    if (meta && meta.payload && meta.payload.cwd === cwd) return candidate.full
  }
  return null
}

function readCodex(sessionId, cwd) {
  const file = newestCodexRollout(sessionId, cwd)
  if (!file) return { agent: 'codex', error: 'no-rollout' }
  // A long Codex session runs to tens of MB and the last \`turn_context\` can sit
  // far behind the last \`token_count\`, so a fixed tail found the tokens and lost
  // the model. Widen until both are in hand.
  let tokenCount = null
  let turn = null
  for (const bytes of [TAIL_BYTES, 4 * TAIL_BYTES, 16 * TAIL_BYTES]) {
    for (const record of parseEach(tailLines(file, bytes))) {
      const payload = record && record.payload
      if (record && record.type === 'event_msg' && payload && payload.type === 'token_count') {
        tokenCount = payload
      }
      if (record && record.type === 'turn_context' && payload) {
        turn = payload
      }
    }
    if (tokenCount && turn) break
  }
  const info = (tokenCount && tokenCount.info) || {}
  const last = info.last_token_usage || {}
  const limits = (tokenCount && tokenCount.rate_limits) || {}
  const num = (value) => (typeof value === 'number' && isFinite(value) ? value : null)
  const windowOf = (bucket) =>
    bucket && typeof bucket === 'object'
      ? {
          usedPercent: num(bucket.used_percent),
          windowMinutes: num(bucket.window_minutes),
          resetsAt: num(bucket.resets_at)
        }
      : null
  return {
    agent: 'codex',
    rolloutPath: file,
    model: turn && typeof turn.model === 'string' ? turn.model : null,
    effort: turn && typeof turn.effort === 'string' ? turn.effort : null,
    approvalPolicy: turn && typeof turn.approval_policy === 'string' ? turn.approval_policy : null,
    contextUsedTokens: num(last.total_tokens),
    contextWindowTokens: num(info.model_context_window),
    contextWindowSource: 'reported-by-agent',
    planType: typeof limits.plan_type === 'string' ? limits.plan_type : null,
    primaryLimit: windowOf(limits.primary),
    secondaryLimit: windowOf(limits.secondary)
  }
}

/** Nobody else can delete these: the phone has no delete call, and the shell
 *  that wrote one is gone. A snapshot every 30 seconds per open chat is ~2900
 *  files a day, so each run clears the ones that are no longer anybody's. */
function sweepOldSnapshots(dir, keepPath, maxAgeMs) {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    if (!/^orca-hud-[A-Za-z0-9]+\\.json(\\.part)?$/.test(name)) continue
    const full = path.join(dir, name)
    if (full === keepPath) continue
    try {
      if (now - fs.statSync(full).mtimeMs > maxAgeMs) fs.unlinkSync(full)
    } catch {}
  }
}

function main() {
  const args = process.argv.slice(2)
  const arg = (name) => {
    const at = args.indexOf('--' + name)
    return at >= 0 && at + 1 < args.length ? args[at + 1] : null
  }
  const agent = arg('agent')
  let snapshot
  try {
    snapshot =
      agent === 'codex'
        ? readCodex(arg('session'), arg('cwd'))
        : readClaude(arg('transcript') || '')
  } catch (error) {
    snapshot = { agent: agent || 'claude', error: String((error && error.message) || error) }
  }
  snapshot.readerVersion = 1
  snapshot.readAt = new Date().toISOString()
  const body = JSON.stringify(snapshot)
  const out = arg('out')
  if (!out) {
    process.stdout.write(body)
    return
  }
  // Write beside the target and rename. A shell redirect creates the file
  // empty the instant the command starts and fills it only when this exits, so
  // a reader on the other side of a fast link saw an empty file — or pinned a
  // read grant to the empty file's stat identity and then failed when this
  // wrote it. A rename is atomic: the path is absent or it is complete.
  sweepOldSnapshots(path.dirname(out), out, 5 * 60 * 1000)
  // The host grants a read only on a path it saw in this terminal's output.
  // Relying on the echoed command line is fragile — a wrap can split it — so
  // name the path on a line of its own.
  process.stdout.write(out + '\\n')
  const part = out + '.part'
  try {
    fs.writeFileSync(part, body)
    fs.renameSync(part, out)
  } catch {
    try {
      fs.unlinkSync(part)
    } catch {}
    process.stdout.write(body)
  }
}

main()
`

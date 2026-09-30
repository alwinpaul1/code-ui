// Codex's unified exec starts a long command with `exec_command` and, while it
// runs, polls its session with `write_stdin` calls whose `chars` is empty or
// omitted: Codex reads the call into `WriteStdinArgs`, whose `chars` carries
// `#[serde(default)]` (codex-rs/core/src/tools/handlers/unified_exec/
// write_stdin.rs at rust-v0.153.4, the same on main), so an omitted `chars` is
// an empty write. A `chars` that is not a string is no poll: serde rejects the
// call. A poll is the command it drives, not a new one: counted as one, a
// single `npm test` polled four times read "Ran 5 commands", and a poll sent
// as just {session_id, yield_time_ms} still did (review, 2026-09-30).
//
// Two shapes reach the phone, both through Orca's Codex decoder
// (src/main/native-chat/transcript-line-decoders-codex.ts), which hands a call
// over under its own name with its arguments verbatim:
// - a function call: `exec_command` / `write_stdin`, arguments an object or,
//   as Codex writes them, a JSON string;
// - code mode (Codex 0.153.4, rollout of 2026-09-06): a custom `exec` cell
//   whose input is source text calling `tools.exec_command({…})` or
//   `tools.write_stdin({…})`. Only a cell that is exactly one such call is
//   read; anything else says nothing, so it counts the way it always did.

/** What one call is to the command count: the start of a unified-exec
 *  command, or a poll (empty or omitted `chars`) of the session `session` drives — null
 *  when the session id cannot be read. Null for every other call, a
 *  write_stdin that types real input included: that input is an action of
 *  its own. */
export type CodexExecRole = { role: 'start' } | { role: 'poll'; session: number | null } | null

function args(input: unknown): Record<string, unknown> | null {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function sessionId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** `text(await tools.<name>({…}));` and nothing else, as Codex writes a cell. */
const CODE_MODE_CALL =
  /^\s*(?:text\(\s*)?await\s+tools\.(exec_command|write_stdin)\(\s*\{([^{}]*)\}\s*\)\s*\)?\s*;?\s*$/

function codeModeRole(source: string): CodexExecRole {
  const match = CODE_MODE_CALL.exec(source)
  if (!match) {
    return null
  }
  if (match[1] === 'exec_command') {
    return { role: 'start' }
  }
  const body = match[2] ?? ''
  // No `chars` key is an empty write too; one that is there must be an empty string literal.
  const hasChars = /(?:^|[{,\s])chars\s*:/.test(body)
  if (hasChars && !/(?:^|[{,\s])chars\s*:\s*(?:""|'')\s*(?:,|$)/.test(body)) {
    return null
  }
  const session = /(?:^|[{,\s])session_id\s*:\s*(\d+)\s*(?:,|$)/.exec(body)
  return { role: 'poll', session: session ? Number(session[1]) : null }
}

export function codexExecRole(name: string, input: unknown): CodexExecRole {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^.*[./]/, '')
  if (key === 'exec_command') {
    return { role: 'start' }
  }
  if (key === 'write_stdin') {
    const parsed = args(input)
    return parsed && (parsed.chars === '' || !('chars' in parsed))
      ? { role: 'poll', session: sessionId(parsed.session_id) }
      : null
  }
  if (key === 'exec' && typeof input === 'string') {
    return codeModeRole(input)
  }
  return null
}

/** Folds a run's polls into the commands they drive, call by call in run
 *  order: true when this call is a poll of a command already counted — one
 *  the run started (any `exec_command` before it; its session id is not read
 *  back from the start's output), or one an earlier poll of the same session
 *  already stands for. A poll with neither counts, as the command it drives
 *  started in an earlier run. */
export function createCodexPollFolder(): (name: string, input: unknown) => boolean {
  let started = false
  const polled = new Set<number>()
  return (name, input) => {
    const exec = codexExecRole(name, input)
    if (exec?.role === 'start') {
      started = true
      return false
    }
    if (exec?.role !== 'poll') {
      return false
    }
    const seen = exec.session !== null && polled.has(exec.session)
    if (exec.session !== null) {
      polled.add(exec.session)
    }
    return started || seen
  }
}

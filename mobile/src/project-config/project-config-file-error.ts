/**
 * What a project-config screen (MCP servers, permission rules, project
 * memory) does with a rejected `files.read` / `files.write` / `files.createFile`
 * reply. One classifier for all three screens, so a host message is read the
 * same way everywhere instead of three ad hoc `.includes()` checks drifting
 * apart.
 *
 * The three literal messages below are not guesses: they are the exact text
 * Orca's desktop runtime throws, read from the 1.4.205 bundle
 * (`/tmp/orca-asar/out/main/index.js`, 2026-09-18):
 *
 *   - `u8()` (the relative-path jail check) throws `Error('invalid_relative_path')`
 *     for an absolute path or a `..` segment.
 *   - the mobile WebSocket dispatch gate (`iRa`, the mobile-scope method
 *     allowlist) rejects with `{code:'forbidden', message:"Method '<name>' is
 *     not available to mobile clients"}` for any method not on the list.
 *     `files.write` is NOT on that list — only `files.read`, `files.createFile`
 *     and a handful of others are. So every `files.write` this app ever sends
 *     is refused by the host, always, for every project-config screen. This
 *     is not a bug in this repo: it is a real gap in Orca's mobile RPC
 *     surface (the same shape as `orca-mobile-rpc-settings-whitelist.md`'s
 *     keep-awake keys) and the fix is upstream, not here.
 *   - a missing file surfaces Node's own `ENOENT: no such file or directory,
 *     open '<path>'` from the underlying `fs` read.
 */
export type ProjectConfigFileErrorKind =
  | 'jailed'
  | 'missing'
  | 'binary'
  | 'write-blocked'
  | 'unknown'

const WRITE_BLOCKED_RE = /is not available to mobile clients/i
const MISSING_RE = /ENOENT|no such file or directory|not_found|not found/i

export function classifyProjectConfigFileError(message: string): ProjectConfigFileErrorKind {
  if (WRITE_BLOCKED_RE.test(message)) {
    return 'write-blocked'
  }
  if (message === 'invalid_relative_path') {
    return 'jailed'
  }
  if (message === 'binary_file') {
    return 'binary'
  }
  if (MISSING_RE.test(message)) {
    return 'missing'
  }
  return 'unknown'
}

/** One sentence for the error banner. Never invents a retry that cannot work:
 *  `write-blocked` says so plainly instead of suggesting "try again". */
export function describeProjectConfigFileError(
  message: string,
  op: 'read' | 'write' | 'create'
): string {
  const kind = classifyProjectConfigFileError(message)
  switch (kind) {
    case 'jailed':
      return 'This path is outside the project, so the host refused it.'
    case 'binary':
      return "This isn't a text file."
    case 'missing':
      return op === 'read' ? 'Not found on the host yet.' : 'Not found on the host.'
    case 'write-blocked':
      return op === 'create'
        ? "The phone can't create files in this project yet — Orca's mobile connection blocks it. Create the file from the desktop, then come back to edit it here."
        : "The phone can't save this file yet — Orca's mobile connection blocks writing project files from a phone. Copy your edits and paste them in on the desktop for now."
    case 'unknown':
      return message || 'Something went wrong.'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

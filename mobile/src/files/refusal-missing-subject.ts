/** What a refusal says is not there: the file that was read, something else, or nothing it names. */
export type RefusalMissingSubject = 'file' | 'other' | null

/** A machine token for a thing not found: the file read's own `not_found`, or a named one such as
 *  `selector_not_found`, `method_not_found`, `worktree_not_found_on_server`. Group 1 is the name. */
const NOT_FOUND_TOKEN = /(?:^|[^a-z_])((?:[a-z]+_)*)not_found(?![a-z])/
/** "no such file or directory" (ENOENT's own words, SFTP's "No such file"), "no such worktree". */
const NO_SUCH = /\bno such ([a-z]+)/
/** The word before "not found" / "does not exist": "File not found", "Worktree not found", "Remote
 *  Orca runtime not found", "Unknown worktree selector id:x (not found)", "Project was not found". */
const NOT_FOUND_PHRASE = /([^\s(]+)\s+(?:(?:was|is)\s+)?\(?(?:not found|does not exist)/

/**
 * What a refusal says is missing, read off its shape rather than a list of the desktop's phrases.
 * The code and the message each name it: a `<thing>_not_found` token, the noun after "no such", or
 * the word before "not found" / "does not exist". ENOENT, the bare `not_found` token and a named
 * "file" are the file; any other name is something else, and something else wins when both are
 * named. A bare "Not found" names nothing (null), so the code decides or nothing does.
 *
 * Only the file is a positive answer on purpose: previewError read ANY "not found" as "File not
 * found", which the markdown figure resolver keeps for good, so "Worktree not found" or "Remote
 * Orca runtime not found" left a figure a link until the document closed (review 2026-09-30,
 * round 4). A wording this misses ("'fig.png' does not exist") costs one more read on the next
 * connection, never a figure kept as a link.
 */
export function refusalMissingSubject(code: string, message: string): RefusalMissingSubject {
  const named = [...namedMissing(code), ...namedMissing(message)]
  if (named.includes('other')) {
    return 'other'
  }
  return named.includes('file') ? 'file' : null
}

/** A quoted path or name ('…', "…", `…`) is data the refusal carries, not its words: ENOENT quotes
 *  the path it could not open, and a file named "user_not_found.png" or "page not found.png" must
 *  not read as something else missing (review 2026-10-01). */
const QUOTED = /'[^']*'|"[^"]*"|`[^`]*`/g

function namedMissing(text: string): RefusalMissingSubject[] {
  const said = text.toLowerCase().replace(QUOTED, "''")
  const named: RefusalMissingSubject[] = []
  if (/\benoent\b/.test(said)) {
    named.push('file')
  }
  const token = NOT_FOUND_TOKEN.exec(said)
  if (token) {
    const thing = token[1] ?? ''
    named.push(thing === '' || thing === 'file_' ? 'file' : 'other')
  }
  const noSuch = NO_SUCH.exec(said)
  if (noSuch) {
    named.push(noSuch[1] === 'file' ? 'file' : 'other')
  }
  const phrase = NOT_FOUND_PHRASE.exec(said)
  if (phrase) {
    named.push((phrase[1] ?? '').replace(/[^a-z]/g, '') === 'file' ? 'file' : 'other')
  }
  return named
}

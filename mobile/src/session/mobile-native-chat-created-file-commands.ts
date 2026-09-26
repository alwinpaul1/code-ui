// Commands that name a created file and still leave it as the Write made it.
//
// A later command naming a cut create's file voids its count, since it may
// have written the file. Most runs that name it only use it: the Claude app
// heads "Created a file, ran a command" with the create's count when the
// command made it executable, ran it, read it, or staged it (review of
// 2026-09-26). So a command is let through when every part of it is one of
// those and nothing in it can write where a word says:
//
// - no redirect but a descriptor copy (`2>&1`) or `/dev/null`, no
//   backticks, and no bracket: a `(` opens a subshell or a substitution, a
//   zsh glob qualifier can run code, and PowerShell runs `echo (rm f)`;
// - no `--output`, the option `git diff`, `log` and `show` write a file with;
// - each part of a `&&`, `||`, `;`, `|` or `&` chain, or of a line, is a verb
//   that writes no file (`chmod`, `cat`, `head`, `tail`, `wc`, `less`,
//   `stat`, `file`, `ls`, `cd`, `echo`, `pwd`, `true`), a `git add`, `diff`,
//   `status`, `log` or `show`, an interpreter given the file itself (`bash`,
//   `sh`, `zsh`, `python`, `python3`, `node`), or the file itself run by its
//   path, after any `NAME=value` settings.
//
// Anything else still voids the count: `tee`, `sed`, `perl`, `mv`, `cp`, `rm`
// and `git commit` are no such verb, so an in-place flag never reaches one
// that honours it. The words are split on whitespace alone, so a quoted
// separator or `>` reads as one and refuses, never the other way, and a
// heredoc's lines read as parts of their own, which its end marker refuses.
//
// A relative name is matched as a suffix, so a script of the file's name run
// from another folder passes: the folder the shell was left in is not in the
// transcript.

/** Redirects that write no file: a descriptor copied onto another, or
 *  output thrown away. `>&2.log` and `>/dev/null.bak` name files. */
const HARMLESS_REDIRECT = /(?:\d*>&\d+|&>>?\s*\/dev\/null|\d*>>?\s*\/dev\/null)(?=$|[\s;&|])/g
/** A redirect left over, or a command whose words do not show what it runs. */
const UNREADABLE = /[`>()]/
const SEPARATOR = /&&|\|\||[;|&\n]/
const WRITES_A_NAMED_FILE = /^--output/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const QUOTED = /^(["'])(.*)\1$/

/** Verbs that write no file, whatever they are given. */
const READ_VERBS = new Set([
  'cat',
  'cd',
  'chmod',
  'echo',
  'file',
  'head',
  'less',
  'ls',
  'pwd',
  'stat',
  'tail',
  'true',
  'wc'
])
/** Git subcommands that leave the working tree alone. */
const GIT_READS = new Set(['add', 'diff', 'log', 'show', 'status'])
/** Interpreters that run the file they are given first. */
const INTERPRETERS = new Set(['bash', 'node', 'python', 'python3', 'sh', 'zsh'])

function wordsOf(part: string): string[] {
  return part
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => QUOTED.exec(word)?.[2] ?? word)
}

function partLeavesFileAlone(part: string, isTheFile: (word: string) => boolean): boolean {
  const words = wordsOf(part)
  if (words.some((word) => WRITES_A_NAMED_FILE.test(word))) {
    return false
  }
  // An empty part, or settings alone, runs nothing.
  const firstVerb = words.findIndex((word) => !ASSIGNMENT.test(word))
  if (firstVerb === -1) {
    return true
  }
  const verb = words[firstVerb]!
  const next = words[firstVerb + 1]
  if (READ_VERBS.has(verb)) {
    return true
  }
  if (verb === 'git') {
    return next !== undefined && GIT_READS.has(next)
  }
  if (INTERPRETERS.has(verb)) {
    return next !== undefined && isTheFile(next)
  }
  // A bare name is looked up on the PATH, which may be another program.
  return verb.includes('/') && isTheFile(verb)
}

/** Whether `command` provably leaves the file alone: `isTheFile` says
 *  whether a word is the file's own path or name. */
export function commandLeavesFileAlone(
  command: string,
  isTheFile: (word: string) => boolean
): boolean {
  const joined = command.replaceAll('\\\n', ' ').replace(HARMLESS_REDIRECT, ' ')
  if (UNREADABLE.test(joined)) {
    return false
  }
  return joined.split(SEPARATOR).every((part) => partLeavesFileAlone(part, isTheFile))
}

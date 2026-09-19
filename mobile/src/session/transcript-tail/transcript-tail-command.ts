import { TAIL_ROW_MAX_CHARS } from './transcript-tail-records'

/** Title the tail terminal is created with. The phone hides tabs carrying it
 *  from its own strip; on the desktop it names the tab for what it is. */
export const TRANSCRIPT_TAIL_TAB_TITLE = 'Code UI · transcript'

export function isTranscriptTailTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && title.trim() === TRANSCRIPT_TAIL_TAB_TITLE
}

/** The strip and every terminal count, without the phone's own tail
 *  terminals: by title, and by handle for the ones this process holds. The
 *  handle matters: the host adopted a background terminal into its strip as
 *  "Terminal 3", dropping the title it was created with, and the tab showed
 *  on the phone (device, 2026-09-19). Anything that is not a terminal passes
 *  through untouched. */
export function withoutTranscriptTailTerminals<
  T extends { type?: string; title?: string | null; terminal?: string | null; handle?: string }
>(items: readonly T[], ownedHandles: ReadonlySet<string> = NO_HANDLES): T[] {
  return items.filter((item) => {
    if (item.type !== undefined && item.type !== 'terminal') {
      return true
    }
    const handle = item.handle ?? item.terminal ?? null
    return !isTranscriptTailTitle(item.title) && !(handle !== null && ownedHandles.has(handle))
  })
}

const NO_HANDLES: ReadonlySet<string> = new Set()

/** Rows to ask the tail for at start. The runtime keeps about a hundred
 *  stream rows (measured 2026-09-19: `oldestCursor` trailed `latestCursor` by
 *  ~100), and `tail` prints its backlog faster than the first read lands, so
 *  asking for more than fits only drops the oldest before they are seen.
 *  History comes from Orca's reader anyway; the tail is for what it drops. */
export const TAIL_BACKLOG_ROWS = 60

function posixSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** The command the tail terminal runs. POSIX: `tail -F` keeps following
 *  across the rename Claude does on compaction; `awk` cuts each row and
 *  flushes per line (a plain pipe would block-buffer and the phone would
 *  see nothing for kilobytes). Windows is the PowerShell form, and like the
 *  HUD's Windows path it has not run on a Windows machine. */
/** What names the transcript: its path when the host disclosed one, else the
 *  session id, which Claude Code uses as the file's basename under
 *  `~/.claude/projects/<slug>/`. A hand-started session often has only the id
 *  (the host learned it from the agent's own hook; the path never reached
 *  the phone), and the shell's glob finds the file wherever the slug put it. */
export type TranscriptTailFile =
  | { kind: 'path'; transcriptPath: string }
  | { kind: 'session'; sessionId: string }

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/

/** A registry key for the file, the same whichever way it was named. */
export function transcriptTailFileKey(file: TranscriptTailFile): string {
  return file.kind === 'path' ? `path:${file.transcriptPath}` : `session:${file.sessionId}`
}

export function transcriptTailFile(
  transcriptPath: string | null | undefined,
  sessionId: string | null | undefined
): TranscriptTailFile | null {
  if (transcriptPath) {
    return { kind: 'path', transcriptPath }
  }
  if (sessionId && SESSION_ID.test(sessionId)) {
    return { kind: 'session', sessionId }
  }
  return null
}

/** Only the rows the phone reads leave the host, and none of a pasted
 *  image's base64 does: a row is cut at its first image block (the prompt's
 *  text comes before it; the phone reads cut rows by shape) and at
 *  TAIL_ROW_MAX_CHARS. `awk` here uses index() and substr() only — no regex
 *  intervals, which older awks lack — and flushes per line, or a plain pipe
 *  would block-buffer and the phone would see nothing for kilobytes. Before
 *  the filter the desktop tab was a wall of base64 (2026-09-19).
 *
 *  Three shapes, all a person's own words or the queue: a queue operation,
 *  a queued prompt taken mid-turn, and a typed turn — the last is a user
 *  row whose content is a string or opens with a text block, which a tool
 *  result (also `type: user`, content opening with `tool_use_id`) never
 *  does. Tool calls and results used to come too, for the "Running · 12s"
 *  row; that row is gone, and they were most of what the desktop tab
 *  showed — a whole LaTeX chapter in one tool result (screenshot,
 *  2026-09-19). */
const KEPT_ROW_MARKS = [
  '"queue-operation"',
  'queued_command',
  '"role":"user","content":"',
  '"role":"user","content":[{"type":"text"'
]
const AWK_CUT =
  `| awk '{ if (${KEPT_ROW_MARKS.map((mark) => `index($0, "${mark.replace(/"/g, '\\"')}")`).join(' || ')}) { ` +
  `i = index($0, "\\"type\\":\\"image\\""); if (i > 0) $0 = substr($0, 1, i - 1); ` +
  `print substr($0, 1, ${TAIL_ROW_MAX_CHARS}) }; fflush() }'`
const PS_CUT =
  `| Where-Object { ${KEPT_ROW_MARKS.map((mark) => `$_.Contains('${mark}')`).join(' -or ')} } ` +
  `| ForEach-Object { $i = $_.IndexOf('"type":"image"'); $s = if ($i -ge 0) { $_.Substring(0, $i) } else { $_ }; ` +
  `if ($s.Length -gt ${TAIL_ROW_MAX_CHARS}) { $s.Substring(0, ${TAIL_ROW_MAX_CHARS}) } else { $s } }`

/** The command the tail terminal runs. POSIX: `tail -F` keeps following
 *  across the rename Claude does on compaction; `awk` cuts each row and
 *  flushes per line (a plain pipe would block-buffer and the phone would
 *  see nothing for kilobytes). Windows is the PowerShell form, and like the
 *  HUD's Windows path it has not run on a Windows machine. */
export function transcriptTailCommand(
  file: TranscriptTailFile,
  platform: 'win32' | 'posix'
): string {
  if (platform === 'win32') {
    const target =
      file.kind === 'path'
        ? `-LiteralPath ${powershellSingleQuoted(file.transcriptPath)}`
        : `-LiteralPath (Get-ChildItem -Path "$env:USERPROFILE\\.claude\\projects\\*\\${file.sessionId}.jsonl" | Select-Object -First 1).FullName`
    return `Get-Content ${target} -Tail ${TAIL_BACKLOG_ROWS} -Wait ${PS_CUT}`
  }
  // The id is checked against SESSION_ID, so it is safe unquoted; the glob
  // must be unquoted to expand.
  const target =
    file.kind === 'path'
      ? posixSingleQuoted(file.transcriptPath)
      : `"$HOME"/.claude/projects/*/${file.sessionId}.jsonl`
  return `tail -n ${TAIL_BACKLOG_ROWS} -F ${target} ${AWK_CUT}`
}

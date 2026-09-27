import type { MobileChatPermission } from './mobile-native-chat-permission'
import { permissionOptionsFromScreen } from './mobile-terminal-permission-options'

/**
 * The title row of Claude Code's Bash permission dialog. 2.1.283's frame
 * (`Pi`/`X3` in its binary) draws the title, then, when the request came from
 * somewhere other than the lead, a one-cell gap, a dim "· " and where it came
 * from: `from the ${agent} agent`, `from a subagent`, `from the "${name}"
 * workflow`, `from a workflow`, `from a remote cloud agent`, `from the ${name}
 * plugin`, `from a plugin`. The Bash title itself is "Bash command", or with
 * " (unsandboxed)" or " (runs on ${machine})" after it. The whole row must
 * match, so a title quoted in conversation history does not count and a
 * decoration this list does not know is refused (the chat then says a prompt
 * waits in the terminal). Until 2026-09-27 only the bare title matched, and a
 * background subagent's prompt sat unseen for eight hours
 * (fixtures/claude-screen-subagent-bash-permission-2.1.283.txt).
 */
const TITLE =
  /^(\s*)Bash command(?: \((?:unsandboxed|runs on [^)]+)\))?(?: · (from (?:the (?:"[^"]+" workflow|\S.*? (?:agent|plugin))|a (?:subagent|workflow|plugin|remote cloud agent))))?\s*$/

/** A row of the auto-deny countdown 2.1.283 draws on the timed shape of the
 *  classifier's denial-limit fallback (`Tt`). It changes every second, so it
 *  cannot be part of what identifies the prompt: the send path compares the
 *  whole card with a fresh read before it writes a digit. `Tt` draws it in a
 *  box of its own, last in the reason block, outside the `│` gutter, with a
 *  blank row under it. Read from the binary; no real screen has shown one. */
const COUNTDOWN = /will automatically deny this request in /

const indentOf = (row: string): number => row.length - row.trimStart().length

/** Require a live selected Bash approval, not a quoted prompt in conversation history. */
export function claudePermissionFromScreen(lines: readonly string[]): MobileChatPermission | null {
  const start = lines.findLastIndex((line) => TITLE.test(line))
  if (start === -1) {
    return null
  }
  const [, margin, origin] = TITLE.exec(lines[start]!)!
  const dialog = lines.slice(start + 1)
  const menu = dialog.findIndex((line) => /^\s*[❯›>]\s*\d[.)]\s/.test(line))
  const first = dialog.findIndex((line) => /^\s*[❯›>]?\s*1[.)]\s+Yes\b/.test(line))
  const end = dialog.findIndex((line) => /Esc to cancel.*Tab to amend/i.test(line))
  if (
    menu === -1 ||
    first === -1 ||
    end < first ||
    !dialog.some((line) => /Do you want to proceed\?/.test(line))
  ) {
    return null
  }
  const options = permissionOptionsFromScreen(dialog.slice(first, end))
  if (!options) {
    return null
  }
  const { body, notes } = splitDialogBody(dialog.slice(0, first), margin!.length)
  return {
    title: 'Allow Bash?',
    ...(origin ? { description: origin.charAt(0).toUpperCase() + origin.slice(1) } : {}),
    ...(notes ? { decisionReason: notes } : {}),
    detail: body.join('\n').trim(),
    options
  }
}

/**
 * Tell the tool's own rows from the harness's notes about them. The command
 * and its description sit in a box indented two cells past the title; the
 * decision reason (the classifier's, a rule's, a hook's), its hints and any
 * warning come after that box at the title's own column (2.1.283, `kS`). Both
 * put a `│` gutter on a multi-line block, so the gutter cannot tell them apart
 * and the card folded the classifier's reason into the command. The column
 * can. A row at the title's column BEFORE the box (the auto-mode tip) stays in
 * the body, where the card already drops it.
 */
function splitDialogBody(
  rows: readonly string[],
  margin: number
): { body: string[]; notes: string | null } {
  const box = rows.findIndex((row) => row.trim().length > 0 && indentOf(row) > margin)
  const body: string[] = []
  const notes: string[] = []
  let countdown = false
  rows.forEach((row, index) => {
    const blank = row.trim().length === 0
    const note =
      box !== -1 &&
      index > box &&
      !blank &&
      indentOf(row) === margin &&
      !/^\s*Do you want to proceed\?\s*$/.test(row)
    // A wrapped tail of the countdown goes with it. Its box ends at the first
    // row that is not one of its own: a blank, the body, a gutter row.
    countdown = note && (COUNTDOWN.test(row) || (countdown && !/^\s*│/.test(row)))
    if (countdown) {
      return
    }
    if (!note) {
      body.push(row)
      return
    }
    const text = row.trim().replace(/^│\s?/, '').trim()
    if (text) {
      notes.push(text)
    }
  })
  return { body, notes: notes.length > 0 ? notes.join('\n') : null }
}

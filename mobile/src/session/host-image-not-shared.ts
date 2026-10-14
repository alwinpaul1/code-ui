/** The host resolved the path and granted nothing. Outside every workspace
 *  Orca 1.4.223's resolveTerminalPath shares a file on one of two rules:
 *  (1) assistant text in the session's transcript tail names it, or (2) the
 *  path lies under a temp folder and the tab's terminal printed it, as one
 *  unbroken string, in its recent raw output. Every refusal comes back as the
 *  same empty resolution, so this says what the phone knows of each rule.
 *  It cannot see the desktop's other rule-2 refusals (no cwd for the handle,
 *  a handle from another worktree), and it takes /var/folders as macOS's
 *  $TMPDIR; a Linux host with its own $TMPDIR is reported as outside it.
 *
 *  Rule 2 rarely holds for a Read (Claude Code 2.1.296, captured 2026-10-09):
 *  the path shows only on a `⎿` row under `Reading N files…`, painted once
 *  and then folded into `Read N files`. Its renderer writes only the cells
 *  that changed, so a cell the last frame already held splits the path with
 *  a cursor move (`/pr\x1b[15Gvate/tmp/…`), a row narrower than the path
 *  wraps it, and a parallel read that ends between frames is never painted. */
export function notShared(args: {
  path: string
  nativeChatContext: unknown
  terminalHandle: string | null
  agentTextNamesPath?: boolean
}): string {
  const rule1 = !args.nativeChatContext
    ? 'not checked, no chat session was sent'
    : args.agentTextNamesPath
      ? "this chat's text names it, but the desktop's transcript tail did not"
      : 'it is not'
  const rule2 = !args.terminalHandle
    ? 'Rule 2, printed in the terminal: not checked, no terminal handle was sent'
    : !/^\/(?:private\/)?tmp\/|^\/(?:private\/)?var\/folders\//.test(args.path)
      ? 'Rule 2, printed in the terminal: cannot apply, it is outside the temp folders (/tmp, $TMPDIR)'
      : `Rule 2, printed in terminal ${args.terminalHandle}: not found there as one unbroken path ` +
        "(Claude Code shows a Read's path once, while it runs, on a row its renderer can split or wrap)"
  return `the desktop did not share it (outside every workspace). Rule 1, named in the agent's text: ${rule1}. ${rule2}`
}

/** One numbered row of the dialog. */
export type ClaudePermissionDialogOption = {
  digit: string
  /** The row's words, a wrapped second line folded in. */
  text: string
  /** The `❯` is on it. */
  highlighted: boolean
}

export type ClaudePermissionDialog = {
  options: ClaudePermissionDialogOption[]
  /** The digit the `❯` is on, or null when no row carries it. */
  highlighted: string | null
  /** The footer offers "Tab to amend": Tab on the highlighted row opens it for words. */
  amendable: boolean
}

// The footer under every Claude Code permission dialog: "Esc to cancel · Tab to amend", and plain
// "Esc to cancel" once a row has been opened for typing (Claude Code 2.1.299, real frames in
// fixtures/claude-screen-permission-amend-2.1.299.txt).
const FOOTER = /^\s*Esc to cancel(?:\s·\s.*)?\s*$/
const OPTION_ROW = /^\s*([❯›>])?\s*(\d)[.)]\s+(\S.*?)\s*$/
// A row that wraps under its option: Claude indents it past the digits (six cells in the
// capture), where an option starts at one or three.
const CONTINUATION_ROW = /^ {4,}(\S.*?)\s*$/

const QUESTION_REACH = 16

/**
 * The permission dialog at the bottom of the screen: its numbered rows, which one the `❯` is on,
 * and whether the footer offers Tab to amend. Null when the screen shows no dialog this can
 * read, which is a refusal and never a guess: a row it does not understand, a footer with no
 * question over it, rows that do not count up from 1.
 *
 * Anchored on the footer and the question ("Do you want to proceed?", "Do you want to create
 * x?"), so a numbered list further up (the conversation, the file a Write shows, an earlier
 * dialog quoted in a reply) is never read as the options.
 */
export function readClaudePermissionDialog(lines: readonly string[]): ClaudePermissionDialog | null {
  const footerAt = lines.findLastIndex((line) => FOOTER.test(line))
  if (footerAt === -1) {
    return null
  }
  // Up from the footer to the question: the line that ends in "?" and is not an option.
  let questionAt = -1
  for (let at = footerAt - 1; at >= 0 && footerAt - at <= QUESTION_REACH; at -= 1) {
    const line = lines[at]!
    if (!OPTION_ROW.test(line) && /\?\s*$/.test(line)) {
      questionAt = at
      break
    }
  }
  if (questionAt === -1) {
    return null
  }
  const options: ClaudePermissionDialogOption[] = []
  for (const row of lines.slice(questionAt + 1, footerAt)) {
    if (row.trim() === '') {
      continue
    }
    const option = OPTION_ROW.exec(row)
    if (option) {
      options.push({ digit: option[2]!, text: option[3]!, highlighted: option[1] !== undefined })
      continue
    }
    const more = CONTINUATION_ROW.exec(row)
    const last = options.at(-1)
    if (!more || !last) {
      return null
    }
    last.text = `${last.text} ${more[1]!}`
  }
  if (options.length === 0 || options.some((option, at) => Number(option.digit) !== at + 1)) {
    return null
  }
  const marked = options.filter((option) => option.highlighted)
  if (marked.length > 1) {
    return null
  }
  return {
    options,
    highlighted: marked[0]?.digit ?? null,
    amendable: /Tab to amend/.test(lines[footerAt]!)
  }
}

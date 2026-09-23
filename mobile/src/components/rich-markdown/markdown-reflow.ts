/**
 * Fill wrapped prose to the screen.
 *
 * A single newline inside a paragraph is a SPACE in markdown, not a break; only two trailing
 * spaces or an unescaped trailing backslash end a line. Painting every source newline as a
 * `<br />` is what made an 80-column document read as a ragged column on the phone (reported
 * 2026-09-15 against this repo's CLAUDE.md). Only an ODD run of trailing backslashes ends in an
 * unescaped one, so a Windows path ending `C:\\` is not a break.
 *
 * Code UI's own; upstream's editor paints every source newline. It lived in the document's script
 * strings until #21969 made them modules.
 */
export function reflowLines(lines: readonly string[]): string {
  let out = ''
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ''
    const line = index > 0 ? raw.replace(/^[ \t]+/, '') : raw
    if (index === lines.length - 1) {
      out += line.replace(/[ \t]+$/, '')
      break
    }
    let slashes = 0
    while (slashes < line.length && line.charAt(line.length - 1 - slashes) === '\\') {
      slashes += 1
    }
    if (slashes % 2 === 1) {
      out += `${line.slice(0, -1)}\n`
    } else if (/ {2,}$/.test(line)) {
      out += `${line.replace(/[ \t]+$/, '')}\n`
    } else {
      out += `${line.replace(/[ \t]+$/, '')} `
    }
  }
  return out
}

/**
 * The lines under a list item that continue it: indented, non-blank, and neither an item of their
 * own nor the start of another block. Without this the list ENDED at the first continuation line
 * and the rest of the item became a paragraph at the left margin, outside the list — which is what
 * the device screenshot showed for numbered item 2 (2026-09-15).
 *
 * `opensItem` and `opensBlock` are the list's and the block reader's own grammars, handed in so
 * this module reads neither and imports neither: the block reader imports the list parser.
 */
export function gatherListItemContinuation(
  lines: readonly string[],
  startIndex: number,
  text: string,
  opensItem: (line: string) => boolean,
  opensBlock: (line: string) => boolean
): { text: string; nextIndex: number } {
  const tail = [text]
  let index = startIndex
  while (index < lines.length) {
    const next = lines[index] ?? ''
    if (!next.trim() || !/^\s/.test(next) || opensItem(next) || opensBlock(next)) {
      break
    }
    tail.push(next.trim())
    index += 1
  }
  return { text: tail.length > 1 ? reflowLines(tail) : text, nextIndex: index }
}

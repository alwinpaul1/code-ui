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
    const form = hardBreakForm(line)
    if (form === 'backslash') {
      out += `${line.slice(0, -1)}\n`
    } else if (form === 'spaces') {
      out += `${line.replace(/[ \t]+$/, '')}\n`
    } else {
      out += `${line.replace(/[ \t]+$/, '')} `
    }
  }
  return out
}

/** How a line that is not a paragraph's last ends it: a hard break, and in which form, or none. */
export type HardBreakForm = 'backslash' | 'spaces'

export function hardBreakForm(line: string): HardBreakForm | null {
  let slashes = 0
  while (slashes < line.length && line.charAt(line.length - 1 - slashes) === '\\') {
    slashes += 1
  }
  if (slashes % 2 === 1) {
    return 'backslash'
  }
  return / {2,}$/.test(line) ? 'spaces' : null
}

/**
 * The attribute on a paragraph whose source wrote a hard break with two trailing spaces: the form
 * of each of its breaks, in order, so a save writes them back that way (html-paragraph-markdown.ts).
 * None for a paragraph whose breaks are all backslashes, the form the writer uses by itself.
 */
export const HARD_BREAKS_ATTRIBUTE = 'data-md-breaks'

/**
 * A paragraph's lines as its markup's inside and attributes: reflowed, drawn by `renderInline`,
 * every hard break a `<br />`, and the breaks' forms remembered. Refuses to remember them when the
 * drawn words hold a different count of breaks than the source did (an image's alt text takes its
 * newline away), since which break was which is then unknown.
 */
export function paragraphParts(
  lines: readonly string[],
  renderInline: (text: string) => string
): { attributes: string; html: string } {
  const drawn = renderInline(reflowLines(lines))
  const forms = lines
    .slice(0, -1)
    .map((line) => hardBreakForm(line))
    .filter((form): form is HardBreakForm => form !== null)
  const breaks = drawn.split('\n').length - 1
  const remembered = forms.includes('spaces') && breaks === forms.length
  return {
    attributes: remembered ? ` ${HARD_BREAKS_ATTRIBUTE}="${forms.join(' ')}"` : '',
    html: drawn.replace(/\n/g, '<br />')
  }
}

/**
 * The lines under a list item that continue it: non-blank, and neither an item of their own nor
 * the start of another block. Without this the list ENDED at the first continuation line and the
 * rest of the item became a paragraph at the left margin, outside the list — which is what the
 * device screenshot showed for numbered item 2 (2026-09-15).
 *
 * A line at the margin continues it too, lazily, where `opensBlock` lets it (markdown-lazy-line.ts).
 * This ended the item at every unindented line until 2026-09-30, so a save cut a git-wrapped item
 * in two with a blank line.
 *
 * `opensItem` and `opensBlock` are the list's and the block reader's own grammars, handed in so
 * this module reads neither and imports neither: the block reader imports the list parser.
 * `opensBlock` is given the line under the one it tests too, since a table opens on two.
 */
export function gatherListItemContinuation(
  lines: readonly string[],
  startIndex: number,
  text: string,
  opensItem: (line: string) => boolean,
  opensBlock: (line: string, under: string | undefined) => boolean
): { text: string; nextIndex: number } {
  const tail = [text]
  let index = startIndex
  while (index < lines.length) {
    const next = lines[index] ?? ''
    if (!next.trim() || opensItem(next) || opensBlock(next, lines[index + 1])) {
      break
    }
    tail.push(next.trim())
    index += 1
  }
  return { text: tail.length > 1 ? reflowLines(tail) : text, nextIndex: index }
}

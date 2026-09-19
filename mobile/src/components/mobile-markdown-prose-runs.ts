import type { MobileMarkdownBlock } from './mobile-markdown-parser'

/**
 * How a document's blocks are grouped into selectable Texts.
 *
 * Why one Text per run: Android confines a selection to a single Text node,
 * so a reader could select one paragraph but never the next (2026-09-12,
 * screenshot). Consecutive paragraphs and headings become one selectable
 * Text, headings as nested styled spans and a blank line between blocks.
 * A `---` rule and an image link join the run too, drawn as spans: each
 * was its own View, and a document with a rule before every section let a
 * selection reach the end of a section and no further (2026-09-19,
 * screenshot of thesis_explained.md). Lists and quotes join it as well:
 * an item was a row View with its own Text, so a selection that started in
 * the paragraph above a list stopped at the list's first bullet (2026-09-19,
 * screenshot of the phone). The price is the hanging indent — a span has no
 * margin, so a wrapped item continues under its bullet, as plain text does.
 *
 * An image the phone cannot draw joins as a link span. A drawn figure does
 * NOT: it was tried as an inline view inside the Text (so a selection could
 * cross it) and Android drew it over the heading above it and the prose
 * below, with the text laid out as if the figure were a line high (device
 * 2026-09-19, thesis_explained.md after "3. What the ASP-DAC reviewers
 * said"). An inline view that grows after the first layout is not something
 * RN Android re-lays reliably, so a figure is a block of its own and a
 * selection stops at it. Fences and tables start a new run too.
 *
 * Why a run is not the whole document: with lists, quotes and figures all
 * inside it, one run could be a 40 k-character Text holding every code chip
 * of a thesis write-up, and Android drew every chip in it one line off, over
 * the prose (device 2026-09-19, three screenshots). Cut into sections the
 * chips sat where they belong. So a heading starts a new run once the run
 * behind it is long, and a run that is very long breaks anyway; a short
 * section still joins the next one, so a selection crosses the heading
 * between them.
 */
export type ProseBlock = Extract<
  MobileMarkdownBlock,
  { type: 'paragraph' | 'heading' | 'rule' | 'image' | 'list' | 'quote' }
>

export type ProseRun = {
  start: number
  blocks: MobileMarkdownBlock[]
  /** The run's members when it is a prose run; null for a block that draws
   *  itself (fence, table, drawn figure). */
  prose: ProseBlock[] | null
  chars: number
}

/** A heading starts a new prose run once the run before it holds this much
 *  text; a run breaks anyway past the hard cap. The thesis write-up's
 *  sections are 1–4 k characters and drew right one per run; the whole
 *  document as one run did not (2026-09-19). */
export const RUN_SECTION_CHARS = 3000
export const RUN_HARD_CHARS = 12_000

function proseChars(block: ProseBlock): number {
  if (block.type === 'list') {
    return block.items.reduce((sum, item) => sum + item.text.length, 0)
  }
  if (block.type === 'rule' || block.type === 'image') {
    return 0
  }
  return block.text.length
}

function runMayGrow(run: ProseRun, block: ProseBlock): boolean {
  return block.type === 'heading' ? run.chars < RUN_SECTION_CHARS : run.chars < RUN_HARD_CHARS
}

export function buildProseRuns(
  blocks: readonly MobileMarkdownBlock[],
  drawsImage: (url: string) => boolean
): ProseRun[] {
  const isProse = (block: MobileMarkdownBlock): block is ProseBlock =>
    block.type === 'paragraph' ||
    block.type === 'heading' ||
    block.type === 'rule' ||
    block.type === 'list' ||
    block.type === 'quote' ||
    (block.type === 'image' && !drawsImage(block.url))
  const runs: ProseRun[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    const last = runs.at(-1)
    if (isProse(block)) {
      if (last?.prose && last.start + last.blocks.length === index && runMayGrow(last, block)) {
        last.blocks.push(block)
        last.prose.push(block)
        last.chars += proseChars(block)
      } else {
        runs.push({ start: index, blocks: [block], prose: [block], chars: proseChars(block) })
      }
    } else {
      runs.push({ start: index, blocks: [block], prose: null, chars: 0 })
    }
  }
  return runs
}

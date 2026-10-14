import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'
import { CODE_BLOCK_SPEC } from './code-block-spec'

/** Cut a block's lines into runs of `CODE_BLOCK_SPEC.linesPerText`, each run
 *  one string of segments with a newline between its lines. A blank line is
 *  just the two newlines around it; only a run that ENDS on one gets a space,
 *  because a trailing newline alone is not a line to every text engine. */
export function codeTextRuns(lines: readonly MobileSyntaxSegment[][]): MobileSyntaxSegment[][] {
  const runs: MobileSyntaxSegment[][] = []
  for (let start = 0; start < lines.length; start += CODE_BLOCK_SPEC.linesPerText) {
    const run: MobileSyntaxSegment[] = []
    const end = Math.min(start + CODE_BLOCK_SPEC.linesPerText, lines.length)
    for (let index = start; index < end; index += 1) {
      const line = lines[index] ?? []
      if (index > start) {
        run.push({ text: '\n', kind: 'plain' })
      }
      run.push(...line)
      if (index === end - 1 && line.every((segment) => segment.text.length === 0)) {
        run.push({ text: ' ', kind: 'plain' })
      }
    }
    runs.push(run)
  }
  return runs
}

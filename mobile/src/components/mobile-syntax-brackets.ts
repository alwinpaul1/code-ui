import type { MobileSyntaxSegment, MobileSyntaxTokenKind } from '../session/mobile-file-syntax'

const DEPTH_KINDS: readonly MobileSyntaxTokenKind[] = ['bracket1', 'bracket2', 'bracket3']
const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])
const BRACKET = /[()[\]{}]/

/**
 * Brackets coloured by how deeply they nest, three colours in turn, as the
 * desktop's bracket-pair colouring draws them. The depth runs on from line to
 * line. Only code is looked at: a bracket inside a string or a comment is
 * text, and keeps that span's colour. A stray closer does not take the depth
 * below zero, so one bad line cannot shift every pair after it.
 */
export function colorBracketPairs(
  lines: readonly MobileSyntaxSegment[][],
  /** The depth the first line opens at: a chunk below the first carries the
   *  depth of the lines above it (mobile-code-bracket-depth.ts). */
  startDepth = 0
): MobileSyntaxSegment[][] {
  let depth = Math.max(0, startDepth)
  return lines.map((line) => {
    if (!line.some((segment) => isCode(segment) && BRACKET.test(segment.text))) {
      // The depth still has to run on through a line with no brackets in code.
      return line
    }
    const out: MobileSyntaxSegment[] = []
    for (const segment of line) {
      if (!isCode(segment) || !BRACKET.test(segment.text)) {
        out.push(segment)
        continue
      }
      let run = ''
      for (const char of segment.text) {
        if (!OPENERS.has(char) && !CLOSERS.has(char)) {
          run += char
          continue
        }
        if (run) {
          out.push({ text: run, kind: segment.kind })
          run = ''
        }
        if (CLOSERS.has(char)) {
          depth = Math.max(0, depth - 1)
        }
        out.push({ text: char, kind: DEPTH_KINDS[depth % DEPTH_KINDS.length]! })
        if (OPENERS.has(char)) {
          depth += 1
        }
      }
      if (run) {
        out.push({ text: run, kind: segment.kind })
      }
    }
    return out
  })
}

function isCode(segment: MobileSyntaxSegment): boolean {
  return segment.kind === 'plain' || segment.kind === 'punctuation'
}

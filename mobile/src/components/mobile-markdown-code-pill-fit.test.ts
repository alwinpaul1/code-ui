import { describe, expect, it } from 'vitest'
import { codePillWidth, codeTextWidth, cutCodePills, type CodePillFont } from './mobile-markdown-code-chip-split'
import {
  pillFitRoom,
  readPillFits,
  type PillFit,
  type PillLayoutLine,
  type PillSpanDrawn,
  type TextPillFits
} from './mobile-markdown-code-pill-fit'

const FONT: CodePillFont = { fontSize: 14, insets: 10 }
const WIDTH = 360
const width = (piece: string) => codePillWidth(piece, FONT)
const cut = (code: string, firstRoom: number, scale: number, glue = 0) =>
  cutCodePills(code, firstRoom, WIDTH, { ...FONT, scale }, glue)
const PATH = '/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows'
const P = '\uFFFC'
const NOTHING_LEARNT: TextPillFits = { fits: new Map(), scale: 1 }

/** A span as the render drew it with this room. */
function drawn(code: string, fit: PillFit | undefined, scale = 1): PillSpanDrawn {
  const room = pillFitRoom(fit, WIDTH)
  return { code, room, glue: 0, ...cut(code, room, scale) }
}

function read(
  lines: PillLayoutLine[],
  spans: PillSpanDrawn[],
  current: TextPillFits = NOTHING_LEARNT,
  lineWidth = WIDTH
) {
  return readPillFits({
    lines,
    spans,
    lineWidth,
    current,
    cut,
    measure: { textWidth: (piece) => codeTextWidth(piece, 14), insets: 10 },
    proseSize: 15
  })
}

function learnt(result: ReturnType<typeof read>): TextPillFits {
  if (result.kind !== 'changed') {
    throw new Error(`expected a re-cut, read ${result.kind}`)
  }
  return result.next
}

// Lines as Android reports them (FontMetricsUtil.kt, RN 0.86): U+FFFC per
// inline view, `width` counting the trailing space on a soft-wrapped line.
describe("reading a pill's line back from the phone's layout", () => {
  it('measures the room a pill that jumped left on the line above, and cuts it to that', () => {
    // First drawn cut to a whole line, as before anything was measured.
    const span = drawn(PATH, undefined)
    expect(span.pieces.length).toBe(2)
    const next = learnt(
      read(
        [
          { x: 0, width: 92.4, text: '•  Worktree: ' },
          { x: 0, width: 339.2, text: P },
          { x: 0, width: 150, text: `${P}. Branch ` }
        ],
        [span]
      )
    )
    expect(next.fits.get(0)!.room).toBeCloseTo(WIDTH - 92.4, 6)
    const recut = drawn(PATH, next.fits.get(0), next.scale)
    expect(recut.fresh).toBe(false)
    expect(width(recut.pieces[0]!) * next.scale).toBeLessThanOrEqual(WIDTH - 92.4 - 1)
  })

  it('shrinks a first piece the phone drew wider than estimated until it fits', () => {
    const fit = { room: 250 }
    const span = drawn(PATH, fit)
    // Cut for the 250 dp left, and still it went down a line: the room was right.
    const next = learnt(
      read(
        [
          { x: 0, width: 110, text: '•  Worktree: ' },
          { x: 0, width: 300, text: `${P}${P}. Branch ` }
        ],
        [span],
        { fits: new Map([[0, fit]]), scale: 1 }
      )
    )
    const shrunk = next.fits.get(0)!
    expect(shrunk.room).toBe(250)
    expect(shrunk.below).toBe(width(span.pieces[0]!))
    expect(width(drawn(PATH, shrunk).pieces[0]!)).toBeLessThan(width(span.pieces[0]!))
  })

  it('grows a first piece that left the end of its line empty', () => {
    const fit = { room: 100 }
    const span = drawn(PATH, fit)
    expect(span.pieces[0]).toBe('/Users/')
    // The rest of the span, one piece a line after the first.
    const rest = span.pieces.slice(1).map((_, index, all) => ({
      x: 0,
      width: 300,
      text: index === all.length - 1 ? `${P}. Branch ` : `${P} `
    }))
    const next = learnt(
      read([{ x: 0, width: 92.4 + width('/Users/'), text: `•  Worktree: ${P}` }, ...rest], [span], {
        fits: new Map([[0, fit]]),
        scale: 1
      })
    )
    // What it drew plus what it left empty: the room after "Worktree:".
    expect(next.fits.get(0)!.room).toBeCloseTo(WIDTH - 92.4, 6)
  })

  it('makes a span whole again when two of its pieces landed on one line', () => {
    const fit = { room: 60 }
    const span = drawn('fix/chat-rows', fit)
    expect(span.pieces).toEqual(['fix/', 'chat-rows'])
    const next = learnt(
      read([{ x: 0, width: 200, text: `Branch ${P}${P}, commits ` }], [span], { fits: new Map([[0, fit]]), scale: 1 })
    )
    expect(drawn('fix/chat-rows', next.fits.get(0), next.scale).pieces).toEqual(['fix/chat-rows'])
  })
})

// 2026-09-27 review: the cut for the lines after a span's first was a running
// minimum that only ever fell, and a rotation's lines read at the old width
// dropped it for good. The phone's own measure of a pill comes from the
// layout in hand instead, and it rises as well as falls.
describe("learning the phone's width for a pill from the layout in hand", () => {
  const solid = 'x'.repeat(90)

  /** A piece as the phone draws it: text `scale` times the estimate, then
   *  its 10 dp of padding and border; the last with its full stop. */
  function drawnAt(pieces: readonly string[], scale: number): PillLayoutLine[] {
    return pieces.map((piece, index) => {
      const last = index === pieces.length - 1
      return {
        x: 0,
        width: codeTextWidth(piece, 14) * scale + 10 + (last ? codeTextWidth('.', 15) : 0),
        text: last ? `${P}.` : P
      }
    })
  }

  it('reads it off a line that holds one pill and nothing else', () => {
    const span = drawn(solid, undefined)
    // The phone drew each piece's text 8% wider than estimated.
    const next = learnt(read(drawnAt(span.pieces, 1.08), [span]))
    expect(next.scale).toBeCloseTo(1.08, 6)
    for (const piece of drawn(solid, undefined, next.scale).pieces) {
      expect(codeTextWidth(piece, 14) * 1.08 + 10).toBeLessThanOrEqual(WIDTH)
    }
  })

  it('lets pieces grow again when the phone draws them narrower', () => {
    const span = drawn(solid, undefined, 1.08)
    const next = learnt(read(drawnAt(span.pieces, 0.95), [span], { fits: new Map(), scale: 1.08 }))
    expect(next.scale).toBeCloseTo(0.95, 6)
  })

  it('reads a lone pill at the end of a paragraph without pricing the newline', () => {
    // One piece at the estimate (334 dp), too wide at the phone's 1.1: its
    // line, the paragraph's last, ends in a newline Android does not count.
    const token = 'x'.repeat(42)
    const span = drawn(token, undefined)
    expect(span.pieces).toEqual([token])
    const next = learnt(
      read([{ x: 0, width: codeTextWidth(token, 14) * 1.1 + 10, text: `${P}\n` }], [span], { fits: new Map(), scale: 1 })
    )
    expect(next.scale).toBeCloseTo(1.1, 6)
  })

  it('does not swing between two scales when a layout shows only a short pill', () => {
    // A short pill reads the same text scale as a long one, and a reading
    // within 2% of the scale in hand leaves it where it is.
    const span = drawn('68a160e5', undefined, 1.08)
    const result = read(
      [{ x: 0, width: codeTextWidth('68a160e5', 14) * 1.07 + 10 + codeTextWidth('.', 15), text: `${P}.` }],
      [span],
      { fits: new Map(), scale: 1.08 }
    )
    expect(result.kind).toBe('settled')
  })

  it('keeps two continuation pieces of one span off one line', () => {
    // Probe C2: drawn narrower than estimated, the two pieces after the first
    // fit one line together ("npx tsc … &&" at 350 dp estimated, "ls" at 20).
    const command = 'cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && ls'
    const span = drawn(command, { room: 120 })
    expect(span.pieces).toEqual(['cd mobile &&', 'npx tsc --noEmit && npx vitest run && npx oxlint &&', 'ls'])
    const [first, second, third] = span.pieces as [string, string, string]
    const together = (width(second) + width(third)) * 0.9 + 3
    const next = learnt(
      read(
        [
          { x: 0, width: 36 + width(first) * 0.9, text: `Run ${P}` },
          { x: 0, width: together, text: `${P}${P}.` }
        ],
        [span],
        { fits: new Map([[0, { room: 120 }]]), scale: 1 }
      )
    )
    expect(next.scale).toBeLessThanOrEqual(together / (width(second) + width(third)))
    // Three pieces become two: the last no longer rides beside the one before.
    const recut = drawn(command, next.fits.get(0), next.scale).pieces
    expect(recut).toHaveLength(2)
    expect(recut.join(' ')).toBe(command)
  })
})

describe('a layout that settles or cannot be read', () => {
  it('changes nothing once each pill fills the line it starts on', () => {
    const fit = { room: WIDTH - 92.4 }
    const span = drawn(PATH, fit)
    expect(span.pieces.length).toBe(2)
    const result = read(
      [
        { x: 0, width: 92.4 + width(span.pieces[0]!), text: `•  Worktree: ${P}` },
        { x: 0, width: 300, text: `${P}. Branch ` }
      ],
      [span],
      { fits: new Map([[0, fit]]), scale: 1 }
    )
    expect(result.kind).toBe('settled')
  })

  it('leaves a pill that starts a line after a hard break alone', () => {
    const span = drawn('68a160e5', undefined)
    const result = read(
      [
        { x: 0, width: 40, text: 'Commits:\n' },
        { x: 0, width: 80, text: `${P} and more` }
      ],
      [span]
    )
    expect(result.kind).toBe('settled')
  })

  it('leaves a short pill that moved down like a word alone', () => {
    const fit = { room: 30 }
    const span = drawn('68a160e5', fit)
    expect(span.fresh).toBe(true)
    const result = read(
      [
        { x: 0, width: WIDTH - 30, text: 'a long lead-in that nearly fills commits ' },
        { x: 0, width: 120, text: `${P} and more` }
      ],
      [span],
      { fits: new Map([[0, fit]]), scale: 1 }
    )
    expect(result.kind).toBe('settled')
  })

  it('re-cuts from the first span that moved, and says so', () => {
    const settledFirst = drawn('pnpm install', undefined)
    const jumped = drawn(PATH, undefined)
    const result = read(
      [
        { x: 0, width: 150, text: `Run ${P} then see ` },
        { x: 0, width: 339.2, text: P },
        { x: 0, width: 150, text: `${P} for more.` }
      ],
      [settledFirst, jumped]
    )
    expect(result).toMatchObject({ kind: 'changed', firstChanged: 1 })
  })

  it('does not read a layout whose placeholders do not match the pills drawn', () => {
    const span = drawn(PATH, undefined)
    // A stale event from before a re-cut, or U+FFFC typed in the prose.
    expect(read([{ x: 0, width: 92.4, text: '•  Worktree: ' }], [span]).kind).toBe('unreadable')
    expect(
      read([{ x: 0, width: 92.4, text: `${P} typed ${P}` }, { x: 0, width: 300, text: `${P}.` }], [span]).kind
    ).toBe('unreadable')
  })

  it('does not read lines broken to another width, as a rotation first reports them', () => {
    const span = drawn(PATH, { room: WIDTH - 92.4 })
    // The tree as drawn at 360, laid out at 700 before the render catches up.
    const rotated = [{ x: 0, width: 612.5, text: `Worktree: ${P}${P} today.` }]
    expect(read(rotated, [span], { fits: new Map([[0, { room: WIDTH - 92.4 }]]), scale: 1 }).kind).toBe('unreadable')
    // Trailing spaces hang past the edge on Android; they are not words.
    expect(
      read([{ x: 0, width: WIDTH + 6, text: 'a line of plain words that ends in a space ' }, { x: 0, width: 50, text: `${P}.` }], [
        drawn('ok', undefined)
      ]).kind
    ).not.toBe('unreadable')
    // A pill wider than its whole line is the one thing that can run past it.
    const solid = drawn('x'.repeat(90), undefined)
    expect(
      read(
        solid.pieces.map((piece) => ({ x: 0, width: width(piece) + 20, text: P })),
        [solid]
      ).kind
    ).not.toBe('unreadable')
  })

  it('reads nothing before the width is known, and nothing for a Text with no pill', () => {
    const span = drawn(PATH, undefined)
    expect(read([{ x: 0, width: 92.4, text: 'Worktree: ' }, { x: 0, width: 300, text: P }], [span], undefined, 0).kind).toBe(
      'unreadable'
    )
    expect(read([{ x: 0, width: 92.4, text: 'plain words' }], []).kind).toBe('settled')
    expect(read([], []).kind).toBe('settled')
  })
})

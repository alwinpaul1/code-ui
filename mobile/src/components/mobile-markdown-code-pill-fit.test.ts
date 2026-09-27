import { describe, expect, it } from 'vitest'
import { codePillWidth, codeTextWidth, cutCodePills, type CodePillFont } from './mobile-markdown-code-chip-split'
import {
  pillFitRoom,
  pillFitScale,
  readPillFits,
  textPillScale,
  type PillFit,
  type PillLayoutLine,
  type PillSpanDrawn,
  type TextPillFits
} from './mobile-markdown-code-pill-fit'

const FONT: CodePillFont = { fontSize: 14, insets: 10 }
const WIDTH = 360
const width = (piece: string) => codePillWidth(piece, FONT)
const cut = (code: string, firstRoom: number, scale: number, glue = 0, guessed = false) =>
  cutCodePills(code, firstRoom, WIDTH, { ...FONT, scale }, glue, guessed)
const PATH = '/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows'
const P = '\uFFFC'
const NOTHING_LEARNT: TextPillFits = { fits: new Map() }

/** A span as the render drew it with what it had learnt. */
function drawn(code: string, fit: PillFit | undefined): PillSpanDrawn {
  const room = pillFitRoom(fit, WIDTH)
  return { code, room, glue: 0, ...cut(code, room, pillFitScale(fit)) }
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

function readArgs(lines: PillLayoutLine[], spans: PillSpanDrawn[]) {
  return {
    lines,
    spans,
    lineWidth: WIDTH,
    current: NOTHING_LEARNT,
    cut,
    measure: { textWidth: (piece: string) => codeTextWidth(piece, 14), insets: 10 },
    proseSize: 15
  }
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
          // Drawn exactly as estimated.
          { x: 0, width: width(span.pieces[0]!), text: P },
          { x: 0, width: 150, text: `${P}. Branch ` }
        ],
        [span]
      )
    )
    expect(next.fits.get(0)!.room).toBeCloseTo(WIDTH - 92.4, 6)
    const recut = drawn(PATH, next.fits.get(0))
    expect(recut.fresh).toBe(false)
    expect(width(recut.pieces[0]!)).toBeLessThanOrEqual(WIDTH - 92.4 - 1)
  })

  it('shrinks a first piece the phone drew wider than estimated until it fits', () => {
    const fit = { room: 250 }
    const span = drawn(PATH, fit)
    const first = span.pieces[0]!
    // Cut for the 250 dp left, and still it went down a line, alone there:
    // its own line shows it drawn 8% wider than the room.
    const next = learnt(
      read(
        [
          { x: 0, width: 110, text: '•  Worktree: ' },
          { x: 0, width: width(first) * 1.08, text: P },
          { x: 0, width: 200, text: `${P}. Branch ` }
        ],
        [span],
        { fits: new Map([[0, fit]]) }
      )
    )
    const shrunk = next.fits.get(0)!
    expect(shrunk.room).toBe(250)
    expect(width(drawn(PATH, shrunk).pieces[0]!)).toBeLessThan(width(first))
  })

  // Review of 3dd68229: at 800 -> 600 -> 800 the 600 dp lines reached the 800
  // handler; a span that started a line right after the same words there
  // looked cut for that room and gone down anyway, and its first piece was
  // capped a unit short at 800 for good. Nothing on its line proved it wider.
  it('does not cap a first piece that went down a line with another pill beside it', () => {
    // At 800: "the fix lives in [one] and [two, cut for the 284 dp left]".
    const WIDE = 800
    const cutWide = (code: string, firstRoom: number, scale: number, glue = 0) =>
      cutCodePills(code, firstRoom, WIDE, { ...FONT, scale }, glue)
    const draw = (code: string, room: number): PillSpanDrawn => ({ code, room, glue: 0, ...cutWide(code, room, 1) })
    const one = draw('mobile/src/components/use-markdown-code-pill-runs.ts', WIDE)
    const two = draw('mobile/src/components/mobile-markdown-code-pill-fit.ts', 284)
    expect([one.pieces.length, two.pieces.length]).toEqual([1, 2])
    // The same tree broken at 600 and read at 800: the second span starts a
    // line right after the same words, beside its own second piece.
    const result = readPillFits({
      ...readArgs(
        [
          { x: 0, width: 516, text: `the fix lives in ${P} and ` },
          { x: 0, width: 505, text: `${P}${P}, both of them.` }
        ],
        [one, two]
      ),
      lineWidth: WIDE,
      current: { fits: new Map([[1, { room: 284 }]]) },
      cut: cutWide
    })
    expect(result.kind).not.toBe('unreadable')
    expect(result.kind === 'changed' ? result.next.fits.get(1)?.below : undefined).toBeUndefined()
  })

  // Review of 12e3b98e (probe R4-E): the usual shape of a first piece drawn
  // wider than its room is that it goes down a line with its own second
  // piece beside it. A line with another pill on it was not read at all, so
  // the two halves settled side by side, and the line above ended early.
  describe('a first piece drawn wider, gone down beside its own second piece', () => {
    const WIDE = 800
    const cutWide = (code: string, firstRoom: number, scale: number, glue = 0, guessed = false) =>
      cutCodePills(code, firstRoom, WIDE, { ...FONT, scale }, glue, guessed)
    const text = (piece: string) => codeTextWidth(piece, 14)
    const one: PillSpanDrawn = { code: 'mobile/src/components/use-markdown-code-pill-runs.ts', room: WIDE, glue: 0, pieces: ['mobile/src/components/use-markdown-code-pill-runs.ts'], fresh: false }
    const code = 'mobile/src/components/mobile-markdown-code-pill-fit.ts'
    // "I checked this the fix lives in [one] and " ends at 624.5 dp.
    const room = 175.5
    const readAt = (pieces: string[], drawnAs: number, fit: PillFit) =>
      readPillFits({
        ...readArgs(
          [
            { x: 0, width: WIDE - room, text: `I checked this the fix lives in ${P} and ` },
            {
              x: 0,
              width: pieces.reduce((sum, piece) => sum + text(piece) * drawnAs + 10, 0) + codeTextWidth(', both of them.', 15),
              text: `${pieces.map(() => P).join('')}, both of them.`
            }
          ],
          [one, { code, room: pillFitRoom(fit, WIDE), glue: codeTextWidth(',', 15), pieces, fresh: false }]
        ),
        lineWidth: WIDE,
        current: { fits: new Map([[1, fit]]) },
        cut: cutWide
      })

    it('cuts the first piece, at once, to what fits the room drawn as wide as it was', () => {
      const pieces = cutWide(code, room, 1, codeTextWidth(',', 15)).pieces
      expect(pieces).toEqual(['mobile/src/components/', 'mobile-markdown-code-pill-fit.ts'])
      // Drawn 3% wider it does not fit the room, and its second piece
      // follows it down.
      expect(text(pieces[0]!) * 1.03 + 10).toBeGreaterThan(room)
      const result = readAt(pieces, 1.03, { room })
      expect(result.kind).toBe('changed')
      const fit = result.kind === 'changed' ? result.next.fits.get(1)! : {}
      const recut = cutWide(code, pillFitRoom(fit, WIDE), pillFitScale(fit), codeTextWidth(',', 15))
      // One step: moved inside the pair, a break that still left both on the
      // line would lay the line out as before, and Fabric would send nothing.
      expect(recut.pieces[0]).not.toBe(pieces[0])
      expect(text(recut.pieces[0]!) * 1.03 + 10).toBeLessThanOrEqual(room - 1)
    })

    it('does the same when the line holds nothing but the two', () => {
      const pieces = cutWide(code, room, 1, codeTextWidth(',', 15)).pieces
      const result = readPillFits({
        ...readArgs(
          [
            { x: 0, width: WIDE - room, text: `I checked this the fix lives in ${P} and ` },
            { x: 0, width: pieces.reduce((sum, piece) => sum + text(piece) * 1.03 + 10, 0), text: `${P}${P}` }
          ],
          [one, { code, room, glue: 0, pieces, fresh: false }]
        ),
        lineWidth: WIDE,
        current: { fits: new Map([[1, { room }]]) },
        cut: cutWide
      })
      expect(result.kind === 'changed' ? result.next.fits.get(1)!.below : undefined).toBeLessThan(width(pieces[0]!))
    })

    it('leaves it alone drawn as estimated, as a layout broken narrower draws it', () => {
      const pieces = cutWide(code, room, 1, codeTextWidth(',', 15)).pieces
      const result = readAt(pieces, 1, { room })
      expect(result.kind === 'changed' ? result.next.fits.get(1)?.below : undefined).toBeUndefined()
    })
  })

  it('refuses lines where a first piece went down a line with room for it above', () => {
    const span = drawn('mobile/src/components/', { room: 284 })
    const lone = width(span.pieces[0]!)
    expect(lone).toBeLessThan(284)
    expect(
      read([{ x: 0, width: 516, text: 'the fix lives in some words and ' }, { x: 0, width: lone, text: P }], [span], { fits: new Map([[0, { room: 284 }]]) }, 800).kind
    ).toBe('unreadable')
  })

  it('grows a first piece that left the end of its line empty', () => {
    const fit = { room: 100 }
    const span = drawn(PATH, fit)
    expect(span.pieces[0]).toBe('/Users/')
    // The rest of the span, one piece a line after the first.
    const rest = span.pieces.slice(1).map((piece, index, all) =>
      index === all.length - 1 ? { x: 0, width: 300, text: `${P}. Branch ` } : { x: 0, width: width(piece), text: P }
    )
    const next = learnt(
      read([{ x: 0, width: 92.4 + width('/Users/'), text: `•  Worktree: ${P}` }, ...rest], [span], {
        fits: new Map([[0, fit]])
      })
    )
    // What it drew plus what it left empty: the room after "Worktree:".
    expect(next.fits.get(0)!.room).toBeCloseTo(WIDTH - 92.4, 6)
  })

  it('makes a span whole again when two of its pieces landed on one line', () => {
    const fit = { room: 60 }
    const span = drawn('fix/chat-rows', fit)
    expect(span.pieces).toEqual(['fix/', 'chat-rows'])
    const next = learnt(read([{ x: 0, width: 200, text: `Branch ${P}${P}, commits ` }], [span], { fits: new Map([[0, fit]]) }))
    expect(drawn('fix/chat-rows', next.fits.get(0)).pieces).toEqual(['fix/chat-rows'])
  })
})

// 2026-09-27 review: the cut for the lines after a span's first was a running
// minimum that only ever fell, and a rotation's lines read at the old width
// dropped it for good. The phone's own measure of a pill comes from the
// layout in hand instead, and it rises as well as falls.
// 2026-09-27 review: the cut for the lines after a span's first was a running
// minimum that only ever fell, and a rotation's lines read at the old width
// dropped it for good. Review of f8c968a1: one scale per Text swung between
// two cuts when different layouts showed different lone pills. Now each span
// reads its own, from the layout in hand, and never falls below what it read.
describe("learning how wide the phone draws a span's pills", () => {
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

  it('reads it off a line that holds one of its pieces and nothing else', () => {
    const span = drawn(solid, undefined)
    // The phone drew each piece's text 8% wider than estimated.
    const next = learnt(read(drawnAt(span.pieces, 1.08), [span]))
    expect(next.fits.get(0)!.scale).toBeCloseTo(1.08, 6)
    for (const piece of drawn(solid, next.fits.get(0)).pieces) {
      expect(codeTextWidth(piece, 14) * 1.08 + 10).toBeLessThanOrEqual(WIDTH)
    }
  })

  it('takes its first reading narrower too', () => {
    const span = drawn(solid, undefined)
    const next = learnt(read(drawnAt(span.pieces, 0.95), [span]))
    expect(next.fits.get(0)!.scale).toBeCloseTo(0.95, 6)
  })

  it('never falls below what it has read, so it cannot swing between two cuts', () => {
    const fit = { scale: 1.08, floor: 1.08 }
    const span = drawn(solid, fit)
    const result = read(drawnAt(span.pieces, 0.95), [span], { fits: new Map([[0, fit]]) })
    expect(result.kind).toBe('settled')
  })

  it('keeps a pill of arrows from setting the scale of the path beside it', () => {
    // Review of f8c968a1, probe F2: the estimate priced → at 600 against the
    // font's 850; now it reads the font, and each span has its own scale.
    expect(codeTextWidth('→', 1000)).toBe(850)
    const arrows = 'idle→queued→running→done→archived→idle→queued→running→done→archived→idle→queued'
    const path = '/Users/alwinpaul/Desktop/Project'
    const spans = [drawn(arrows, undefined), drawn(path, undefined)]
    expect(spans.map((span) => span.pieces.length)).toEqual([2, 1])
    const next = learnt(
      read(
        [
          // The arrows' pieces drawn 30% wider than estimated, each alone.
          ...spans[0]!.pieces.map((piece) => ({ x: 0, width: codeTextWidth(piece, 14) * 1.3 + 10, text: P })),
          // The path drawn exactly as estimated, after "and ".
          { x: 0, width: codeTextWidth('and ', 15) + width(path) + codeTextWidth('.', 15), text: `and ${P}.` }
        ],
        spans
      )
    )
    expect(next.fits.get(0)!.scale).toBeCloseTo(1.3, 6)
    expect(pillFitScale(next.fits.get(1))).toBeCloseTo(1, 6)
  })

  it('takes a narrower reading from a line of plain words that ends in the pill, and no wider one', () => {
    // The zoom 0.8 command from the sweep: no piece ever alone on a line, so
    // no lone reading; drawn 10% narrower, its first line ended early.
    const path = '/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows'
    const at = (fit: PillFit, scale: number) => {
      const span = drawn(path, fit)
      const [first, ...rest] = span.pieces
      const lines = [
        { x: 0, width: codeTextWidth('Run ', 15) + codeTextWidth(first!, 14) * scale + 10, text: `Run ${P}` },
        ...rest.map((piece, index) => ({
          x: 0,
          width: codeTextWidth(piece, 14) * scale + 10 + (index === rest.length - 1 ? codeTextWidth(' before it.', 15) : 0),
          text: index === rest.length - 1 ? `${P} before it.` : `${P} and`
        }))
      ]
      return read(lines, [span], { fits: new Map([[0, fit]]) })
    }
    const narrower = at({ room: 320 }, 0.9)
    // Read with the words priced 2% narrow: never narrower than it is.
    expect(learnt(narrower).fits.get(0)!.scale).toBeGreaterThanOrEqual(0.9)
    expect(learnt(narrower).fits.get(0)!.scale).toBeLessThan(0.905)
    expect(learnt(narrower).fits.get(0)!.floor).toBeUndefined()
    // Bolder or larger words before the pill only make it look wider: not taken.
    const wider = at({ room: 250 }, 1.1)
    expect(wider.kind === 'changed' ? pillFitScale(wider.next.fits.get(0)) : 1).toBe(1)
  })

  // Review of 63858e9e (F1): at 200% on Android 14 the words were priced
  // linearly, 11% wider than drawn, so a pill at the end of a line of them
  // read 6% narrower than it was, the scale fell with no floor under it, and
  // the pill was cut too long for its room.
  it('does not read a pill narrower than it is off words drawn a little narrower than priced', () => {
    const path = '/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows'
    const fit = { room: 250 }
    const span = drawn(path, fit)
    const [first, ...rest] = span.pieces
    const words = 'Worktree: '
    const result = read(
      [
        // The pill drawn exactly as estimated, the words before it 2% narrower.
        { x: 0, width: codeTextWidth(words, 15) * 0.98 + width(first!), text: `${words}${P}` },
        ...rest.map((piece, index) => ({
          x: 0,
          width: width(piece) + (index === rest.length - 1 ? codeTextWidth(' today.', 15) : 0),
          text: index === rest.length - 1 ? `${P} today.` : P
        }))
      ],
      [span],
      { fits: new Map([[0, fit]]) }
    )
    // Changed for its room, which grew; its scale is not read below 1.
    expect(result.kind).toBe('changed')
    expect(pillFitScale(learnt(result).fits.get(0))).toBeGreaterThan(1 - 1e-9)
  })

  it('cuts a span that has never been alone on a line as the others in its Text read', () => {
    // Every pill drawn 10% wider (a larger system font size scales them all):
    // the long span's lone pieces read it, and the short one follows.
    const long = 'x'.repeat(90)
    const spans = [drawn(long, undefined), drawn('fix/chat-rows', undefined)]
    const lines = [
      ...spans[0]!.pieces.map((piece) => ({ x: 0, width: codeTextWidth(piece, 14) * 1.1 + 10, text: P })),
      { x: 0, width: 150, text: `Branch ${P}, commits` }
    ]
    const next = learnt(read(lines, spans))
    expect(textPillScale(next.fits)).toBeCloseTo(1.1, 6)
    expect(next.fits.get(1)!.scale).toBeUndefined()
    expect(pillFitScale(next.fits.get(1), textPillScale(next.fits))).toBeCloseTo(1.1, 6)
  })

  it('reads a lone pill at the end of a paragraph without pricing the newline', () => {
    // One piece at the estimate (334 dp), too wide at the phone's 1.1: its
    // line, the paragraph's last, ends in a newline Android does not count.
    const token = 'x'.repeat(42)
    const span = drawn(token, undefined)
    expect(span.pieces).toEqual([token])
    const next = learnt(read([{ x: 0, width: codeTextWidth(token, 14) * 1.1 + 10, text: `${P}\n` }], [span]))
    expect(next.fits.get(0)!.scale).toBeCloseTo(1.1, 6)
  })

  it('keeps two continuation pieces of one span off one line', () => {
    // Probe C2: drawn narrower than estimated, the two pieces after the first
    // fit one line together ("npx tsc … &&" at 350 dp estimated, "ls" at 20).
    const command = 'cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && ls'
    const span = drawn(command, { room: 120 })
    expect(span.pieces).toEqual(['cd mobile &&', 'npx tsc --noEmit && npx vitest run && npx oxlint &&', 'ls'])
    const [first, second, third] = span.pieces as [string, string, string]
    const texts = codeTextWidth(second, 14) + codeTextWidth(third, 14)
    const together = texts * 0.9 + 20 + 3
    const next = learnt(
      read(
        [
          { x: 0, width: 36 + codeTextWidth(first, 14) * 0.9 + 10, text: `Run ${P}` },
          { x: 0, width: together, text: `${P}${P}.` }
        ],
        [span],
        { fits: new Map([[0, { room: 120 }]]) }
      )
    )
    expect(next.fits.get(0)!.scale).toBeLessThanOrEqual((together - 20) / texts)
    // Three pieces become two: the last no longer rides beside the one before.
    const recut = drawn(command, next.fits.get(0)).pieces
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
      { fits: new Map([[0, fit]]) }
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
      { fits: new Map([[0, fit]]) }
    )
    expect(result.kind).toBe('settled')
  })

  // Review of f8c968a1, probes H2 and H3: a span cut for a whole line went
  // down, and the room it landed in was taken as the room it had failed at;
  // its first piece was capped there, and two of its pieces stayed side by
  // side. A cap is learnt only where a span was cut for the room it failed in.
  it('does not cap a first piece at a room it was not cut for', () => {
    const span = drawn('fix/chat-rows', undefined)
    const next = learnt(
      read(
        [
          { x: 0, width: WIDTH - 93, text: 'a lead-in that fills the line up to the pill, Branch ' },
          { x: 0, width: 100, text: `${P}, commits` }
        ],
        [span]
      )
    )
    expect(next.fits.get(0)).toMatchObject({ room: 93, below: undefined })
  })

  it('drops a cap the phone has shown to be wrong', () => {
    // A first piece capped under 60 dp, drawn with the piece after it on the
    // same line: the line held both, so the cap is wrong, and the span is
    // whole again.
    const code = '/Users/alwinpaul/Desktop/Project'
    const fit = { room: 250, below: 60 }
    const span = drawn(code, fit)
    expect(span.pieces).toEqual(['/Users/', 'alwinpaul/Desktop/Project'])
    const line = 92.4 + width(span.pieces[0]!) + width(span.pieces[1]!)
    expect(line).toBeLessThan(WIDTH)
    const next = learnt(read([{ x: 0, width: line, text: `Worktree: ${P}${P}` }], [span], { fits: new Map([[0, fit]]) }))
    expect(next.fits.get(0)!.below).toBeUndefined()
    expect(drawn(code, next.fits.get(0)).pieces).toEqual([code])
  })

  it('drops a cap learnt in a smaller room once the span starts further left', () => {
    // Capped at 147 dp in a 188 dp room; a span before it was cut shorter,
    // and now it starts after words that leave it 300 dp.
    const code = 'mobile/src/components/mobile-markdown-code-pill-fit.ts'
    const fit = { room: 188, below: 147 }
    const span = drawn(code, fit)
    const first = width(span.pieces[0]!)
    const next = learnt(
      read(
        [
          { x: 0, width: WIDTH - 300 + first, text: `words ${P}` },
          ...span.pieces.slice(1).map((piece, index, all) =>
            index === all.length - 1
              ? { x: 0, width: width(piece) + codeTextWidth(' end.', 15), text: `${P} end.` }
              : { x: 0, width: width(piece), text: P }
          )
        ],
        [span],
        { fits: new Map([[0, fit]]) }
      )
    )
    expect(next.fits.get(0)).toMatchObject({ room: 300, below: undefined })
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
    expect(read(rotated, [span], { fits: new Map([[0, { room: WIDTH - 92.4 }]]) }).kind).toBe('unreadable')
    // The tree as drawn at 700, laid out at 360 and read at 700: the pill went
    // down a line with 610 dp to spare above it, which greedy breaking never
    // does (review of f8c968a1).
    const wide = drawn(PATH, { room: 700 - 92.4 })
    const narrowed = [
      { x: 0, width: 92.4, text: 'Worktree: ' },
      { x: 0, width: 520, text: P },
      { x: 0, width: 45, text: 'today.' }
    ]
    expect(readPillFits({ ...readArgs(narrowed, [wide]), lineWidth: 700 }).kind).toBe('unreadable')
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

  // Review of 12e3b98e: a prompt bubble as wide as `pnpm install` drawn 10%
  // narrower than estimated (82 dp) cut it in two, and RN laid the two out
  // side by side as wide as they wanted (AT_MOST, 89 dp). Those lines were
  // refused as broken to another width, the bubble grew, the span fitted
  // whole, the bubble shrank, and so on.
  it('still reads how wide its pills are drawn off lines broken to another width, and nothing else', () => {
    const code = 'pnpm install'
    const line = Math.ceil(codeTextWidth(code, 14) * 0.9 + 10)
    const cutAt = (c: string, firstRoom: number, scale: number, glue = 0, guessed = false) =>
      cutCodePills(c, firstRoom, line, { ...FONT, scale }, glue, guessed)
    const span: PillSpanDrawn = { code, room: line, glue: 0, ...cutAt(code, line, 1, 0, true) }
    expect(span.pieces).toEqual(['pnpm', 'install'])
    const pair = span.pieces.reduce((sum, piece) => sum + codeTextWidth(piece, 14) * 0.9 + 10, 0)
    expect(pair).toBeGreaterThan(line + 1)
    const result = readPillFits({ ...readArgs([{ x: 0, width: pair, text: `${P}${P}` }], [span]), lineWidth: line, cut: cutAt })
    expect(result.kind).toBe('changed')
    const fit = result.kind === 'changed' ? result.next.fits.get(0)! : {}
    expect(fit.scale).toBeCloseTo(0.9, 6)
    expect(fit.room).toBeUndefined()
    expect(cutAt(code, pillFitRoom(fit, line), pillFitScale(fit), 0, fit.floor === undefined).pieces).toEqual([code])
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

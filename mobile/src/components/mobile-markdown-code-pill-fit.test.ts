import { describe, expect, it } from 'vitest'
import { codePillWidth, cutCodePills, type CodePillFont } from './mobile-markdown-code-chip-split'
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
const cut = (code: string, firstRoom: number, lineRoom: number) => cutCodePills(code, firstRoom, lineRoom, FONT)
const PATH = '/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows'
const P = '￼'

/** A span as the render drew it with this room. */
function drawn(code: string, fit: PillFit | undefined, lineRoom = WIDTH): PillSpanDrawn {
  const room = pillFitRoom(fit, lineRoom)
  return { code, room, ...cut(code, room, lineRoom) }
}

function read(
  lines: PillLayoutLine[],
  spans: PillSpanDrawn[],
  current: TextPillFits = { fits: new Map(), lineRoom: WIDTH },
  lineWidth = WIDTH
) {
  return readPillFits({ lines, spans, lineWidth, current, cut, width })
}

// Lines as Android reports them (FontMetricsUtil.kt, RN 0.86): U+FFFC per
// inline view, `width` counting the trailing space on a soft-wrapped line.
describe("reading a pill's line back from the phone's layout", () => {
  it('measures the room a pill that jumped left on the line above, and cuts it to that', () => {
    // First drawn cut to a whole line, as before anything was measured.
    const span = drawn(PATH, undefined)
    expect(span.pieces.length).toBe(2)
    const next = read(
      [
        { x: 0, width: 92.4, text: '•  Worktree: ' },
        { x: 0, width: 339.2, text: P },
        { x: 0, width: 150, text: `${P}. Branch ` }
      ],
      [span]
    )
    expect(next!.fits.get(0)!.room).toBeCloseTo(WIDTH - 92.4, 6)
    const recut = drawn(PATH, next!.fits.get(0))
    expect(recut.fresh).toBe(false)
    expect(width(recut.pieces[0]!)).toBeLessThanOrEqual(WIDTH - 92.4 - 1)
  })

  it('shrinks a first piece the phone drew wider than estimated until it fits', () => {
    const fit = { room: 250 }
    const span = drawn(PATH, fit)
    // Cut for the 250 dp left, and still it went down a line: the room was right.
    const next = read(
      [
        { x: 0, width: 110, text: '•  Worktree: ' },
        { x: 0, width: 300, text: `${P}` },
        { x: 0, width: 200, text: `${P}. Branch ` }
      ],
      [span],
      { fits: new Map([[0, fit]]), lineRoom: WIDTH }
    )
    const learnt = next!.fits.get(0)!
    expect(learnt.room).toBe(250)
    expect(learnt.below).toBe(width(span.pieces[0]!))
    expect(width(drawn(PATH, learnt).pieces[0]!)).toBeLessThan(width(span.pieces[0]!))
  })

  it('grows a first piece that left the end of its line empty', () => {
    const fit = { room: 100 }
    const span = drawn(PATH, fit)
    expect(span.pieces[0]).toBe('/Users/')
    // The rest of the span, one piece a line after the first.
    const rest = span.pieces.slice(1).map((_, index, all) => ({
      x: 0,
      width: 300,
      text: index === all.length - 1 ? `${P}. Branch ` : P
    }))
    const next = read(
      [{ x: 0, width: 92.4 + width('/Users/'), text: `•  Worktree: ${P}` }, ...rest],
      [span],
      { fits: new Map([[0, fit]]), lineRoom: WIDTH }
    )
    // What it drew plus what it left empty: the room after "Worktree:".
    expect(next!.fits.get(0)!.room).toBeCloseTo(WIDTH - 92.4, 6)
  })

  it('makes a span whole again when two of its pieces landed on one line', () => {
    const fit = { room: 60 }
    const span = drawn('fix/chat-rows', fit)
    expect(span.pieces).toEqual(['fix/', 'chat-rows'])
    const next = read([{ x: 0, width: 200, text: `Branch ${P}${P}, commits ` }], [span], {
      fits: new Map([[0, fit]]),
      lineRoom: WIDTH
    })
    expect(drawn('fix/chat-rows', next!.fits.get(0)).pieces).toEqual(['fix/chat-rows'])
  })

  it('cuts later pieces narrower when one hangs past the edge of its line', () => {
    const solid = 'x'.repeat(90)
    const span = drawn(solid, undefined)
    const lines = span.pieces.map((_, index) => ({ x: 0, width: index === 0 ? WIDTH + 12 : 100, text: P }))
    const next = read(lines, [span])
    expect(next!.lineRoom).toBeLessThanOrEqual(WIDTH - 12)
  })
})

describe('a layout that settles or cannot be read', () => {
  it('changes nothing once each pill fills the line it starts on', () => {
    const fit = { room: WIDTH - 92.4 }
    const span = drawn(PATH, fit)
    expect(span.pieces.length).toBe(2)
    const next = read(
      [
        { x: 0, width: 92.4 + width(span.pieces[0]!), text: `•  Worktree: ${P}` },
        { x: 0, width: 300, text: `${P}. Branch ` }
      ],
      [span],
      { fits: new Map([[0, fit]]), lineRoom: WIDTH }
    )
    expect(next).toBeNull()
  })

  it('leaves a pill that starts a line after a hard break alone', () => {
    const span = drawn('68a160e5', undefined)
    const next = read(
      [
        { x: 0, width: 40, text: 'Commits:\n' },
        { x: 0, width: 80, text: `${P} and more` }
      ],
      [span]
    )
    expect(next).toBeNull()
  })

  it('leaves a short pill that moved down like a word alone', () => {
    const fit = { room: 30 }
    const span = drawn('68a160e5', fit)
    expect(span.fresh).toBe(true)
    const next = read(
      [
        { x: 0, width: WIDTH - 30, text: 'a long lead-in that nearly fills commits ' },
        { x: 0, width: 120, text: `${P} and more` }
      ],
      [span],
      { fits: new Map([[0, fit]]), lineRoom: WIDTH }
    )
    expect(next).toBeNull()
  })

  it('does not read a layout whose placeholders do not match the pills drawn', () => {
    const span = drawn(PATH, undefined)
    // A stale event from before a re-cut, or U+FFFC typed in the prose.
    expect(read([{ x: 0, width: 92.4, text: `•  Worktree: ` }], [span])).toBeNull()
    expect(read([{ x: 0, width: 92.4, text: `${P} typed ` }, { x: 0, width: 300, text: `${P}.` }], [span])).toBeNull()
  })

  it('reads nothing before the width is known, and nothing for a Text with no pill', () => {
    const span = drawn(PATH, undefined)
    expect(read([{ x: 0, width: 92.4, text: 'Worktree: ' }, { x: 0, width: 300, text: P }], [span], undefined, 0)).toBeNull()
    expect(read([{ x: 0, width: 92.4, text: 'plain words' }], [])).toBeNull()
    expect(read([], [])).toBeNull()
  })
})

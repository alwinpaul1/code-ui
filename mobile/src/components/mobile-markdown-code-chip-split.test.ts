import { describe, expect, it } from 'vitest'
import { codePillWidth, codeTextWidth, cutCodePills, type CodePillFont } from './mobile-markdown-code-chip-split'

/** The prose pill: Instrument Sans 14, 4 dp padding and a 1 dp border a side. */
const FONT: CodePillFont = { fontSize: 14, insets: 10 }
const width = (text: string) => codePillWidth(text, FONT)

describe('the width of code in the paragraph face', () => {
  it('reads the bundled font, not a monospace cell', () => {
    // hmtx of InstrumentSans_400Regular.ttf: "i" 240, "m" 922, per 1000 em.
    expect(codeTextWidth('i', 1000)).toBe(240)
    expect(codeTextWidth('m', 1000)).toBe(922)
    expect(codeTextWidth('mi', 14)).toBeCloseTo((922 + 240) * 0.014, 6)
    expect(width('')).toBe(10)
  })

  it('prices a wide character at a full em, never at nothing', () => {
    expect(codeTextWidth('漢', 14)).toBe(14)
    expect(codeTextWidth('é', 14)).toBeGreaterThan(0)
  })
})

// 2026-09-26: the Claude app starts `/Users/alwinpaul/Desktop/Project/Code`
// right after "Worktree:" and carries the rest to the next line; Code UI cut
// the span to a whole line wherever it started, so the pill jumped whole.
describe('a span cut to the line it starts on', () => {
  const path = '/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows'

  it('fills the room left on the first line, then whole lines', () => {
    // 200 dp left after "Worktree:": "/Users/alwinpaul/Desktop/" is 186.5 dp
    // as a pill, and "Project/" would take it to 239.
    const { pieces, fresh } = cutCodePills(path, 200, 330, FONT)
    expect(fresh).toBe(false)
    expect(pieces[0]).toBe('/Users/alwinpaul/Desktop/')
    expect(width(pieces[0]!)).toBeLessThanOrEqual(200 - 1)
    // The next unit would not have fitted in what the first line had left.
    expect(width(pieces[0]! + 'Project/')).toBeGreaterThan(200 - 1)
    for (const piece of pieces.slice(1)) {
      expect(width(piece)).toBeLessThanOrEqual(330 - 1)
    }
    expect(pieces.join('').replace(/\s/g, '')).toBe(path.replace(/\s/g, ''))
  })

  it('breaks at the space inside a path and drops it from the end of the line', () => {
    // ".../Project/Code" is 274 dp as a pill; "Code UI/" would take it to 297.
    const { pieces } = cutCodePills(path, 290, 330, FONT)
    expect(pieces).toEqual(['/Users/alwinpaul/Desktop/Project/Code', 'UI/.claude/worktrees/chat-rows'])
  })

  it('never leaves two pieces of one span where one would have fitted', () => {
    // 2026-09-20: `.claude/worktrees/agent-a1922af126912f522` was two pills
    // side by side on one line with room to spare.
    const span = '.claude/worktrees/agent-a1922af126912f522'
    expect(cutCodePills(span, 372, 372, FONT).pieces).toEqual([span])
    const { pieces } = cutCodePills(span, 150, 372, FONT)
    expect(pieces).toEqual(['.claude/worktrees/', 'agent-a1922af126912f522'])
  })

  it('moves a span that fits a line but not the room left down whole, like a word', () => {
    expect(cutCodePills('68a160e5', 30, 330, FONT)).toEqual({ pieces: ['68a160e5'], fresh: true })
    expect(cutCodePills('fix/chat-rows', 60, 330, FONT)).toEqual({ pieces: ['fix/', 'chat-rows'], fresh: false })
  })

  it('cuts a command at its spaces', () => {
    const command = 'cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint'
    const { pieces } = cutCodePills(command, 200, 200, FONT)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(width(piece)).toBeLessThanOrEqual(199)
      expect(piece).toBe(piece.trim())
    }
    expect(pieces.join(' ')).toBe(command)
  })
})

describe('degenerate spans', () => {
  it('draws nothing for an empty span', () => {
    expect(cutCodePills('', 100, 300, FONT)).toEqual({ pieces: [], fresh: false })
  })

  it('keeps a one-character span whole, on this line when it fits and the next when not', () => {
    expect(cutCodePills('/', 100, 300, FONT)).toEqual({ pieces: ['/'], fresh: false })
    expect(cutCodePills('/', 5, 300, FONT)).toEqual({ pieces: ['/'], fresh: true })
    expect(cutCodePills('/', 0, 300, FONT)).toEqual({ pieces: ['/'], fresh: true })
  })

  it('cuts a span longer than a whole line to fill every line, first after dashes, then anywhere', () => {
    const token = 'claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/'
    const { pieces, fresh } = cutCodePills(token, 120, 200, FONT)
    expect(fresh).toBe(false)
    expect(pieces.join('')).toBe(token)
    expect(width(pieces[0]!)).toBeLessThanOrEqual(119)
    for (const piece of pieces) {
      expect(width(piece)).toBeLessThanOrEqual(199)
    }
    const solid = 'x'.repeat(120)
    const cut = cutCodePills(solid, 100, 200, FONT)
    expect(cut.pieces.join('')).toBe(solid)
    // Each full line takes as many as fit: one more would not.
    for (const piece of cut.pieces.slice(1, -1)) {
      expect(width(piece + 'x')).toBeGreaterThan(199)
    }
  })

  it('does not leave a stub of a long token at the end of a nearly full line', () => {
    const solid = 'x'.repeat(80)
    // Room for one character and no more: the token starts on the next line.
    const { pieces, fresh } = cutCodePills(solid, width('x') + 2, 200, FONT)
    expect(fresh).toBe(true)
    expect(pieces.join('')).toBe(solid)
  })

  it('still places a character wider than a whole line', () => {
    expect(cutCodePills('漢漢', 5, 12, FONT).pieces).toEqual(['漢', '漢'])
  })

  it('keeps the spaces inside a one-line span, which are its own', () => {
    expect(cutCodePills(' two ', 300, 300, FONT).pieces).toEqual([' two '])
  })
})

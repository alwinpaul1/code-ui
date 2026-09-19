import { describe, expect, it } from 'vitest'
import { sessionModelPillLabel } from './session-model-pill'

/**
 * The pill states what the binary states. Claude Code paints its own
 * `display_name` and effort on the status line — `[Opus 5 (1M context) xhigh
 * | Max 20x]` — and the phone's parser reads exactly that back. That reading is
 * the agent's own word, the same source the VS Code extension and the binary
 * itself use, and it is the ONLY thing the pill may show.
 *
 * Why not the snapshot's model, as before: the snapshot's current value is the
 * tracked RECORD — a pick, a seed, a remembered value — and every wrong-model
 * report has come through it. On 2026-09-18 the pill read "Fable Medium" while
 * the transcript held 1479 turns of claude-opus-5 and not one Fable, the status
 * line painted Opus, the screen parser returned `opus` / `xhigh` from the real
 * screen, and Orca's record carried no model at all. Every source was right and
 * the display was wrong, which means the fault is in the layer between them. A
 * gate on that layer (the previous fix) still let the record's label through.
 *
 * So the pill no longer reads that layer. It reads the live pair and nothing
 * else. Absent a live pair it shows nothing, which is the project's rule for a
 * figure that cannot be known.
 */
describe('the model pill states the agent’s own word', () => {
  it('shows the model family and its effort, and drops the context-window aside', () => {
    // Asked for 2026-09-19: "opus 5 xhigh", "opus 4.8 max". The status line
    // paints "Opus 5 (1M context)"; the aside is a fact about the window, not
    // the model, and it pushed the effort off a phone-width pill.
    expect(
      sessionModelPillLabel({ model: 'opus', label: 'Opus 5 (1M context)', effort: 'xhigh' })
    ).toBe('Opus 5 xhigh')
    expect(sessionModelPillLabel({ model: 'opus', label: 'Opus 4.8', effort: 'max' })).toBe(
      'Opus 4.8 max'
    )
    expect(
      sessionModelPillLabel({ model: 'opus', label: '(1M context)', effort: 'high' })
    ).toBe('opus high')
    // The device showed "Opus 5 (1M conte…" after the label fix: the parser
    // had put the painted name in `model` with no label at all.
    expect(
      sessionModelPillLabel({ model: 'Opus 5 (1M context)', label: null, effort: 'xhigh' })
    ).toBe('Opus 5 xhigh')
  })

  it('shows the label alone when the agent stated no effort', () => {
    expect(sessionModelPillLabel({ model: 'opus', label: 'Opus 5', effort: null })).toBe('Opus 5')
  })

  // The id is the catalog family; the label is what the agent actually said.
  // When the agent gave no name, the family is still its own word.
  it('falls back to the family when the agent gave no name', () => {
    expect(sessionModelPillLabel({ model: 'opus', label: null, effort: 'high' })).toBe('opus high')
  })

  it('shows nothing when the agent has not spoken', () => {
    expect(sessionModelPillLabel({ model: null, label: null, effort: null })).toBeNull()
    expect(sessionModelPillLabel(null)).toBeNull()
  })

  // The case that shipped: a label with no model behind it is not a statement
  // about this session and must not be drawn as one.
  it('shows nothing for a label that arrived without a model', () => {
    expect(sessionModelPillLabel({ model: null, label: 'Fable', effort: 'medium' })).toBeNull()
  })

  // Degenerate: blank strings from a parser that matched an empty bracket.
  it('shows nothing for blank fields', () => {
    expect(sessionModelPillLabel({ model: '', label: '', effort: '' })).toBeNull()
    expect(sessionModelPillLabel({ model: 'opus', label: '   ', effort: '' })).toBe('opus')
  })
})

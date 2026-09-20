import { describe, expect, it } from 'vitest'
import { absorbedQueueKey, observeOwnQueueAbsorption, withAbsorbedPlacement } from './own-queue-absorption'

// 2026-09-20: the desk read "Ran 10 shell commands" then the queued message;
// the phone drew it after 8. The queue box shows the send until the agent
// takes it; the row's leaving is the take, and the tail then is the place.
describe('where the queue box says a send was taken', () => {
  const typed = 'actaully ran 10 shell commands my mobile shows only 8 see what happened and fix that bug confirm with jev'
  // The box at 46 columns, joined by the parser.
  const painted = ['actaully ran 10 shell commands my mobile', 'shows only 8 see what happened and fix', 'that bug confirm with jev'].join('\n')

  it('records the tail when the own row leaves the box, and only then', () => {
    let absorbed = observeOwnQueueAbsorption(new Map(), [], [painted], [typed], 'c8')
    expect(absorbed.size).toBe(0)
    absorbed = observeOwnQueueAbsorption(absorbed, [painted], [painted], [typed], 'c9')
    expect(absorbed.size).toBe(0)
    absorbed = observeOwnQueueAbsorption(absorbed, [painted], [], [typed], 'c10')
    expect(absorbed.get(absorbedQueueKey(typed))).toBe('c10')
    // A later reading with the row still gone changes nothing.
    expect(observeOwnQueueAbsorption(absorbed, [], [], [typed], 'c11')).toBe(absorbed)
  })

  it('ignores a row that is not one of the phone’s own sends', () => {
    const absorbed = observeOwnQueueAbsorption(new Map(), ['typed on the desk'], [], [typed], 'c10')
    expect(absorbed.size).toBe(0)
  })

  it('leaves the take unset while the phone holds no rows to anchor on', () => {
    expect(observeOwnQueueAbsorption(new Map(), [painted], [], [typed], null).size).toBe(0)
  })

  it('places the own pending bubble at the take, not the send-time tail', () => {
    const absorbed = new Map([[absorbedQueueKey(typed), 'c10']])
    const placed = withAbsorbedPlacement([{ id: 'p', text: typed, baselineTailMessageId: 'c8' }], absorbed)
    expect(placed[0]).toMatchObject({ baselineTailMessageId: 'c10', baselineResolved: true })
    expect(withAbsorbedPlacement([{ id: 'q', text: 'other', baselineTailMessageId: 'c8' }], absorbed)[0]!.baselineTailMessageId).toBe('c8')
  })
})

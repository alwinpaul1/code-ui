import { describe, expect, it } from 'vitest'
import { statusTurn } from './native-chat-kept-session-state'

// Orca 1.4.217 (#22452, #22476): after a cancel with a subagent still running, the hook row stays
// `working` (not `monitoring`), earns no turn stamp, and says the lead itself is done through
// `mainAgent: { state: 'done', outcome: 'cancellation' }`.
describe('statusTurn on a row whose lead is done while a child runs', () => {
  it('reads it as background work outliving the turn, though no turn end was stamped', () => {
    expect(statusTurn('working', undefined, undefined, { leadDone: true })).toMatchObject({
      turn: 'background',
      finishedOne: true
    })
  })

  it('still reads a working row whose lead is at work as a running turn', () => {
    expect(statusTurn('working', undefined, undefined, { leadDone: false })).toMatchObject({
      turn: 'working',
      finishedOne: false
    })
    expect(statusTurn('working', undefined, undefined)).toMatchObject({ turn: 'working' })
  })
})

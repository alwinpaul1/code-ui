// Symptom (S23, Android 16, 2026-09-09): with "Deliver while the app is closed"
// on, agent notifications arrived only when the app was opened, or late. The
// app was not exempt from battery optimisation and adaptive battery was on, so
// Doze suspended the link's network while the phone sat idle. A foreground
// service does not lift that; only the exemption does.
import { describe, expect, it } from 'vitest'
import { adviseBackgroundDeliveryPower } from './background-delivery-power'

describe('background delivery power advice', () => {
  it('asks for unrestricted battery use when delivery is on but Android still optimises the app', () => {
    const advice = adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false })
    expect(advice.showRow).toBe(true)
    expect(advice.promptOnEnable).toBe(true)
    expect(advice.caption).toContain('wait until you open the app')
  })

  it('stays quiet once the exemption is granted', () => {
    const advice = adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: true })
    expect(advice.showRow).toBe(false)
    expect(advice.promptOnEnable).toBe(false)
    expect(advice.caption).toBe('')
  })

  it('does not nag about battery when background delivery is off, but still prompts on enable', () => {
    const advice = adviseBackgroundDeliveryPower({ deliveryOn: false, unrestricted: false })
    expect(advice.showRow).toBe(false)
    expect(advice.promptOnEnable).toBe(true)
  })
})

/**
 * 2026-09-15, asked by the user: "what if the other users update the app, will
 * this work?" It did not.
 *
 * The exemption was only ever requested as part of switching delivery ON, so
 * someone who already had notifications on and merely updated was never asked.
 * The settings row was the only other surface, and it is only seen by someone
 * who goes looking. They would get slow notifications indefinitely with nothing
 * saying why — which is exactly the report that started this.
 *
 * So it is also asked once when the app opens with delivery already on and no
 * exemption. Once, not on every launch: a dialog that reappears forever is one
 * people learn to dismiss without reading.
 */
describe('a user who already had notifications on and updated the app', () => {
  it('is asked for the exemption when the app opens', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false, askedOnOpen: false })
        .promptOnOpen
    ).toBe(true)
  })

  it('is not asked again on the next launch', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false, askedOnOpen: true })
        .promptOnOpen
    ).toBe(false)
  })

  it('is not asked when the exemption is already granted', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: true, askedOnOpen: false })
        .promptOnOpen
    ).toBe(false)
  })

  it('is not asked when delivery is off', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: false, unrestricted: false, askedOnOpen: false })
        .promptOnOpen
    ).toBe(false)
  })

  // The row is the standing reminder for anyone who declined the dialog.
  it('still shows the row after declining, so it can be granted later', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false, askedOnOpen: true })
        .showRow
    ).toBe(true)
  })
})

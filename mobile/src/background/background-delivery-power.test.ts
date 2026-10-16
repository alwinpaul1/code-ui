// Symptom (S23, Android 16, 2026-09-09): with "Deliver while the app is closed"
// on, agent notifications arrived only when the app was opened, or late. The
// app was not exempt from battery optimisation and adaptive battery was on, so
// Doze suspended the link's network while the phone sat idle. A foreground
// service does not lift that; only the exemption does.
import { describe, expect, it } from 'vitest'
import { BACKGROUND_POWER_PROMPT, adviseBackgroundDeliveryPower } from './background-delivery-power'

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
 * 2026-10-16, asked by the user: "Set Settings → Apps → Code UI → Battery → Unrestricted. Make this
 * work automatically by default." Their phone had declined the earlier once-a-fortnight ask, so
 * Doze cut the relay whenever it idled and every reopen dialled again.
 *
 * Android lets no app exempt itself; the nearest thing is its own one-tap dialog. So the app now
 * opens that dialog on every launch until the exemption is granted, with no cooldown and no sheet
 * of its own in front of it (background-link-power-on-open.test.ts).
 */
describe('a launch while Android still optimises the app', () => {
  it('asks for the exemption', () => {
    expect(adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false }).promptOnOpen).toBe(true)
  })

  it('is not asked when the exemption is already granted', () => {
    expect(adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: true }).promptOnOpen).toBe(false)
  })

  it('is not asked when delivery is off', () => {
    expect(adviseBackgroundDeliveryPower({ deliveryOn: false, unrestricted: false }).promptOnOpen).toBe(false)
  })

  it('still shows the row after declining, so it can be granted from Settings too', () => {
    expect(adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false }).showRow).toBe(true)
  })
})

/**
 * Android's own dialog reads "Allow [app] to always run in the background? This
 * may use more battery." It says nothing about what is lost by declining, so
 * people decline it reflexively — and then notifications are late and nothing
 * connects the two. One plain sentence beforehand is the only lever that
 * actually moves acceptance (2026-09-15).
 */
describe('what the app says before Android asks', () => {
  it('leads with what the reader gets, not with the permission', () => {
    expect(BACKGROUND_POWER_PROMPT.body).toMatch(/notification/i)
    expect(BACKGROUND_POWER_PROMPT.body).not.toMatch(/battery optimi[sz]ation/i)
  })

  it('names the cost honestly rather than hiding it', () => {
    expect(BACKGROUND_POWER_PROMPT.body).toMatch(/battery/i)
  })

  it('offers a way out that is not a dead end', () => {
    expect(BACKGROUND_POWER_PROMPT.dismiss).toBeTruthy()
    expect(BACKGROUND_POWER_PROMPT.confirm).toBeTruthy()
  })
})

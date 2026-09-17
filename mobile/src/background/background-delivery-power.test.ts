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
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false, askedAgo: null })
        .promptOnOpen
    ).toBe(true)
  })

  it('is not asked again on the next launch', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false, askedAgo: 60_000 })
        .promptOnOpen
    ).toBe(false)
  })

  it('is not asked when the exemption is already granted', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: true, askedAgo: null })
        .promptOnOpen
    ).toBe(false)
  })

  it('is not asked when delivery is off', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: false, unrestricted: false, askedAgo: null })
        .promptOnOpen
    ).toBe(false)
  })

  // The row is the standing reminder for anyone who declined the dialog.
  it('still shows the row after declining, so it can be granted later', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: false, askedAgo: 60_000 })
        .showRow
    ).toBe(true)
  })
})

/**
 * The exemption is not permanent: the user can revoke it, and Android's own
 * adaptive battery can take it back. Once that happens the app is in exactly the
 * state this whole mechanism exists to prevent — Doze suspending the link — but
 * it had already asked for this version, so it would never ask again and the
 * notifications would just go quiet.
 *
 * A grant we SAW and then lost is a revocation, and is worth one more ask.
 */
describe('an exemption that was granted and then taken away', () => {
  it('asks again, even though this version already asked once', () => {
    expect(
      adviseBackgroundDeliveryPower({
        deliveryOn: true,
        unrestricted: false,
        askedAgo: 60_000,
        wasUnrestricted: true
      }).promptOnOpen
    ).toBe(true)
  })

  it('does not keep asking once that one ask is spent', () => {
    expect(
      adviseBackgroundDeliveryPower({
        deliveryOn: true,
        unrestricted: false,
        askedAgo: 60_000,
        wasUnrestricted: false
      }).promptOnOpen
    ).toBe(false)
  })

  it('says nothing while the exemption still stands', () => {
    const advice = adviseBackgroundDeliveryPower({
      deliveryOn: true,
      unrestricted: true,
      askedAgo: 60_000,
      wasUnrestricted: true
    })
    expect(advice.promptOnOpen).toBe(false)
    expect(advice.showRow).toBe(false)
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

/**
 * Asking once per app VERSION sounded gentle and is not. Nothing records the
 * answer, so Allow suppresses future prompts only because the exemption then
 * exists — while "Not now" stores nothing and the next release asks again. Two
 * versions shipped within an hour on 2026-09-17, so someone who declined was
 * asked twice in an hour, and the complaint was that every update asks.
 *
 * That is the failure this file's own comment warns about — "a dialog that
 * reappears forever is one people learn to dismiss without reading" — reached
 * through the update door instead of the launch one.
 *
 * A cooldown fixes the frequency without abandoning the reason the prompt
 * exists: someone whose notifications are silently late still gets reminded,
 * just not by every release.
 */
describe('how often a decline is asked again', () => {
  const DAY = 24 * 60 * 60 * 1000
  const base = { deliveryOn: true, unrestricted: false }

  it('asks someone who has never been asked', () => {
    expect(adviseBackgroundDeliveryPower({ ...base, askedAgo: null }).promptOnOpen).toBe(true)
  })

  it('does not ask again the next day', () => {
    expect(adviseBackgroundDeliveryPower({ ...base, askedAgo: DAY }).promptOnOpen).toBe(false)
  })

  // The point of the fix: shipping four releases in a week must not mean four
  // prompts. Nothing about a version number is evidence the answer has changed.
  it('does not ask again just because a new version arrived', () => {
    expect(adviseBackgroundDeliveryPower({ ...base, askedAgo: 2 * DAY }).promptOnOpen).toBe(false)
  })

  it('asks again once the cooldown has passed', () => {
    expect(adviseBackgroundDeliveryPower({ ...base, askedAgo: 15 * DAY }).promptOnOpen).toBe(true)
  })

  /**
   * A grant that was taken away is different from one never given: the app is
   * now in exactly the state this mechanism exists to prevent, and the user did
   * not necessarily do it — Android's adaptive battery revokes on its own.
   * Worth one ask even inside the cooldown.
   */
  it('asks immediately when a grant it had was taken away', () => {
    expect(
      adviseBackgroundDeliveryPower({ ...base, askedAgo: DAY, wasUnrestricted: true }).promptOnOpen
    ).toBe(true)
  })

  it('never asks when the exemption is already granted', () => {
    expect(
      adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted: true, askedAgo: null })
        .promptOnOpen
    ).toBe(false)
  })

  // Degenerate: a clock that went backwards (timezone, NTP, manual change)
  // must not read as "asked in the future" and suppress the prompt for ever.
  it('treats a negative age as never asked', () => {
    expect(adviseBackgroundDeliveryPower({ ...base, askedAgo: -DAY }).promptOnOpen).toBe(true)
  })
})

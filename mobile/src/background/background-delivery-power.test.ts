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

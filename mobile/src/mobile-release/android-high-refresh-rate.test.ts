import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../plugins/android-high-refresh-rate.js') as {
  applyHighRefreshRate: (contents: string) => string
  HIGH_REFRESH_RATE_MARKER: string
}

// The shape expo prebuild emits, trimmed to the part this touches.
const MAIN_ACTIVITY = `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
  }
}`

describe('the Android window asks for the panel it is on', () => {
  it('requests the fastest mode the display offers', () => {
    const patched = plugin.applyHighRefreshRate(MAIN_ACTIVITY)

    // React Native asks for nothing, so an adaptive 120/144 Hz panel is free to
    // composite this window at 60 Hz — and does.
    expect(patched).toContain('preferredRefreshRate = fastest')
    expect(patched).toContain('maxByOrNull { it.refreshRate }')
    // After super.onCreate, or the window has no attributes to set yet.
    expect(patched.indexOf(plugin.HIGH_REFRESH_RATE_MARKER)).toBeGreaterThan(
      patched.indexOf('super.onCreate(null)')
    )
  })

  it('never crashes a launch over a refresh rate', () => {
    expect(plugin.applyHighRefreshRate(MAIN_ACTIVITY)).toContain('runCatching {')
  })

  it('is idempotent, because prebuild reruns over its own output', () => {
    const once = plugin.applyHighRefreshRate(MAIN_ACTIVITY)

    expect(plugin.applyHighRefreshRate(once)).toBe(once)
  })

  it('refuses rather than silently skipping when the anchor moves', () => {
    expect(() => plugin.applyHighRefreshRate('class MainActivity')).toThrow(/super.onCreate/)
  })
})

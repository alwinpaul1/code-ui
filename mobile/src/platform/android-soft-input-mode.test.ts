import { describe, expect, it } from 'vitest'
import {
  ANDROID_SOFT_INPUT_MODE,
  applyAndroidSoftInputMode
} from '../../plugins/android-soft-input-mode'

describe('the soft keyboard when Code UI comes to the front', () => {
  it('stays down on cold start, resume, and task-switch back', () => {
    // Reported 2026-09-10: opening the app raised the keyboard before the
    // user had touched anything. Android restores the IME with the activity
    // unless the window says otherwise, and "adjustResize" alone says nothing
    // about visibility.
    const activity = { $: { 'android:windowSoftInputMode': 'adjustResize' } }
    applyAndroidSoftInputMode(activity)
    expect(activity.$['android:windowSoftInputMode']).toBe(ANDROID_SOFT_INPUT_MODE)
    expect(ANDROID_SOFT_INPUT_MODE).toContain('stateAlwaysHidden')
  })

  it('keeps resizing for the keyboard, so tapping the input still lifts the composer', () => {
    // stateAlwaysHidden governs window entry only; it must not cost us the
    // pan/resize behaviour the chat composer depends on once the user taps.
    expect(ANDROID_SOFT_INPUT_MODE).toContain('adjustResize')
  })

  it('is idempotent, so a second prebuild does not stack flags', () => {
    const activity = { $: { 'android:windowSoftInputMode': ANDROID_SOFT_INPUT_MODE } }
    applyAndroidSoftInputMode(activity)
    expect(activity.$['android:windowSoftInputMode']).toBe(ANDROID_SOFT_INPUT_MODE)
  })
})

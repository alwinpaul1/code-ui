const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins')

// Why: Android restores the soft keyboard along with the activity. Coming back
// from the background, or cold-starting after the keyboard was last open, the
// system re-raised it before the user had touched anything — the composer took
// half the screen on every launch. `adjustResize` alone says how the window
// reacts to the keyboard, never whether it should be up.
//
// `stateAlwaysHidden` governs window ENTRY only: the keyboard is down whenever
// the window gains focus, and tapping the input still raises it normally.
// `adjustResize` stays so the composer lifts above the keyboard once it is up.
//
// Expo's `android.softwareKeyboardLayoutMode` only chooses pan vs resize, so
// there is no app.json field for this and it has to be a manifest plugin.
const ANDROID_SOFT_INPUT_MODE = 'adjustResize|stateAlwaysHidden'

/** Pure so a test can pin the flags without running a prebuild. */
function applyAndroidSoftInputMode(activity) {
  activity.$['android:windowSoftInputMode'] = ANDROID_SOFT_INPUT_MODE
  return activity
}

module.exports = function withAndroidSoftInputMode(config) {
  return withAndroidManifest(config, (cfg) => {
    applyAndroidSoftInputMode(AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults))
    return cfg
  })
}

module.exports.ANDROID_SOFT_INPUT_MODE = ANDROID_SOFT_INPUT_MODE
module.exports.applyAndroidSoftInputMode = applyAndroidSoftInputMode

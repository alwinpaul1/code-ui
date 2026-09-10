const { withMainActivity } = require('expo/config-plugins')

// Why: React Native never tells Android what frame rate it wants, so on a
// panel with an adaptive refresh rate the system is free to composite this
// window at 60 Hz — and it usually does. Every frame the terminal's scroller
// computes is then shown at 60 Hz on a 120 Hz phone, and worse, the system can
// switch rates mid-gesture, which reads as the scroll stuttering.
//
// `preferredRefreshRate` only chooses among modes at the CURRENT resolution, so
// it cannot resize the display, and Android is free to ignore it (thermals, low
// battery). Wrapped in runCatching because a refresh rate is never worth
// crashing a launch over.
const MARKER = '// @code-ui high-refresh-rate'

const SNIPPET = `    ${MARKER} begin
    runCatching {
      val activeDisplay =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay
      val fastest = activeDisplay?.supportedModes?.maxByOrNull { it.refreshRate }?.refreshRate
      if (fastest != null && fastest > 0f) {
        window.attributes = window.attributes.apply { preferredRefreshRate = fastest }
      }
    }
    ${MARKER} end`

/** Pure so a test can pin the injection without running a prebuild. */
function applyHighRefreshRate(contents) {
  if (contents.includes(MARKER)) {
    return contents
  }
  const anchor = 'super.onCreate(null)'
  if (!contents.includes(anchor)) {
    throw new Error('MainActivity has no super.onCreate(null) to anchor the refresh-rate request to')
  }
  return contents.replace(anchor, `${anchor}\n${SNIPPET}`)
}

module.exports = function withAndroidHighRefreshRate(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(`MainActivity is ${cfg.modResults.language}; expected Kotlin`)
    }
    cfg.modResults.contents = applyHighRefreshRate(cfg.modResults.contents)
    return cfg
  })
}

module.exports.applyHighRefreshRate = applyHighRefreshRate
module.exports.HIGH_REFRESH_RATE_MARKER = MARKER

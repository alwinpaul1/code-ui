const { withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

// Why: the native ghostty terminal sizes its cells with Typeface.MONOSPACE, and
// on Samsung One UI that static does not resolve to the system's DroidSansMono —
// Samsung's Monotype FlipFont packages substitute typefaces in-process. Measured
// on a Galaxy S23 (450 dpi, 13 dp): a cell came out 31 px wide (0.84 em, a
// proportional advance) instead of ~22 px, so the grid was 34 columns, every
// glyph sat in a cell it did not fill, and 51-column output wrapped at 34.
//
// The WebView engine never hit this because it draws with its own CSS font
// stack. The native view must do the same: ship a real monospace font in the
// APK's assets and never trust the OEM alias. Roboto Mono, OFL, four faces so
// bold and italic keep the same advance.
const FONT_FILES = [
  'RobotoMono-Regular.ttf',
  'RobotoMono-Bold.ttf',
  'RobotoMono-Italic.ttf',
  'RobotoMono-BoldItalic.ttf'
]

/** Pure so a test can pin which files land where without running a prebuild. */
function terminalFontCopies(projectRoot, platformProjectRoot) {
  const targetDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'assets', 'fonts')
  return FONT_FILES.map((file) => ({
    from: path.join(projectRoot, 'assets', 'fonts', file),
    to: path.join(targetDir, file)
  }))
}

module.exports = function withAndroidTerminalFonts(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      for (const { from, to } of terminalFontCopies(
        cfg.modRequest.projectRoot,
        cfg.modRequest.platformProjectRoot
      )) {
        if (!fs.existsSync(from)) {
          throw new Error(`terminal font missing from assets/fonts: ${path.basename(from)}`)
        }
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.copyFileSync(from, to)
      }
      return cfg
    }
  ])
}

module.exports.FONT_FILES = FONT_FILES
module.exports.terminalFontCopies = terminalFontCopies

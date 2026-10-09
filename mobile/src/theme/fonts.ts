import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
  useFonts
} from '@expo-google-fonts/instrument-sans'
import { installInstrumentSansText } from './instrument-sans-text'

/** The code face, the one weight, from the repo with its licence (SIL OFL
 *  1.1) beside it in assets/fonts/jetbrains-mono/: the same file the
 *  @expo-google-fonts package carried, which kept its licence out of the
 *  repo. The chat transcript's code blocks and inline code are set in it
 *  (TRANSCRIPT_MARKDOWN_TYPOGRAPHY), as the file reader's code is. Metro
 *  bundles what is required, so the release APK carries this file. */
const JetBrainsMono_400Regular: number = require('../../assets/fonts/jetbrains-mono/JetBrainsMono-Regular.ttf')

export { fontFamily, type FontWeight } from './tokens'

// Every screen that renders a Text without a face gets Instrument Sans.
// The root layout imports this module before the tree paints.
installInstrumentSansText()

/** Loads the four Instrument Sans faces and the one code face. Only the root
 *  layout calls this; every other module reads the family names from
 *  `tokens.ts`.
 *
 *  Why a bundled code face: `fontFamily: 'monospace'` is not monospace on a
 *  Samsung. One UI's FlipFont packages substitute typefaces in-process, so the
 *  file reader drew code in a proportional face with its wrapped lines at
 *  column zero (screenshot, 2026-09-19) — the same defect the terminal hit
 *  and fixed by bundling its own font.
 *
 *  Bundling was not the whole fix. Code still drew proportional on 2026-09-26,
 *  because `installInstrumentSansText` gives every Text that names no face
 *  Instrument Sans, and a coloured span is a nested Text: it named the UI face
 *  over the line's code face. Each code span names `fontFamily.mono` itself
 *  (`syntaxSpanStyles` in MobileSyntaxSegments.tsx). */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    JetBrainsMono_400Regular
  })
}

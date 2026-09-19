import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
  useFonts
} from '@expo-google-fonts/instrument-sans'
// The one weight, from its own entry: the package root requires every weight
// and Metro bundles what is required, which was 28 files for one face.
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular'

export { fontFamily, type FontWeight } from './tokens'

/** Loads the four Instrument Sans faces and the one code face. Only the root
 *  layout calls this; every other module reads the family names from
 *  `tokens.ts`.
 *
 *  Why a bundled code face: `fontFamily: 'monospace'` is not monospace on a
 *  Samsung. One UI's FlipFont packages substitute typefaces in-process, so the
 *  file reader drew code in a proportional face with its wrapped lines at
 *  column zero (screenshot, 2026-09-19) — the same defect the terminal hit
 *  and fixed by bundling its own font. */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    JetBrainsMono_400Regular
  })
}

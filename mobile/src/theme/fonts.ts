import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
  useFonts
} from '@expo-google-fonts/instrument-sans'

export { fontFamily, type FontWeight } from './tokens'

/** Loads the four Instrument Sans faces. Only the root layout calls this; every
 *  other module reads the family names from `tokens.ts`. */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold
  })
}

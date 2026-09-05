import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  colorsForScheme,
  fontFamily,
  radius,
  space,
  type,
  type ThemeColors,
  type ThemePreference,
  type ThemeScheme
} from './tokens'

export const THEME_PREFERENCE_STORAGE_KEY = 'codeui:theme-preference'

export type Theme = {
  scheme: ThemeScheme
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  colors: ThemeColors
  space: typeof space
  radius: typeof radius
  type: typeof type
  fonts: typeof fontFamily
  isDark: boolean
}

function resolveScheme(
  preference: ThemePreference,
  // RN 0.83 widens ColorSchemeName to include 'unspecified'; anything but
  // 'dark' resolves light.
  systemScheme: string | null | undefined
): ThemeScheme {
  if (preference === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light'
  }
  return preference
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function buildTheme(
  preference: ThemePreference,
  scheme: ThemeScheme,
  setPreference: (preference: ThemePreference) => void
): Theme {
  return {
    scheme,
    preference,
    setPreference,
    colors: colorsForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

// Why a static fallback instead of throwing: pure unit tests render leaf
// components without the provider, and the light palette is the safe default.
const fallbackTheme = buildTheme('system', 'light', () => undefined)

const ThemeContext = createContext<Theme>(fallbackTheme)

export function ThemeProvider({
  children,
  initialPreference
}: {
  children: ReactNode
  /** Skips the async read; used by tests and previews. */
  initialPreference?: ThemePreference
}) {
  const systemScheme = useColorScheme()
  const [preference, setPreferenceState] = useState<ThemePreference>(
    initialPreference ?? 'system'
  )

  useEffect(() => {
    if (initialPreference) {
      return
    }
    let cancelled = false
    AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isThemePreference(stored)) {
          setPreferenceState(stored)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [initialPreference])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, next).catch(() => undefined)
  }, [])

  const scheme = resolveScheme(preference, systemScheme)
  const value = useMemo(
    () => buildTheme(preference, scheme, setPreference),
    [preference, scheme, setPreference]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

/** Memoized StyleSheet-shaped object built from the live theme. */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme()
  return useMemo(() => factory(theme), [factory, theme])
}

import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core'
import { useEffect, useMemo, type ComponentType, type ReactNode } from 'react'
import { PixelRatio, processColor, type NativeSyntheticEvent, type ViewProps } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { nativeProseHeightDp, nativeProseLayoutWidth, nativeProseSpec } from './native-prose-spec'
import type { NativeProseTextProps } from './native-prose-text-props'

/**
 * Android (Metro picks this file over native-prose-text.tsx): a prose run of a reply drawn by
 * modules/orca-native-prose as ONE selectable TextView, with the bullets set in from the margin, a
 * wrapped bullet line hanging under the bullet's words and air between bullets, as the Claude app
 * draws a reply (the user, 2026-10-09). One view, so a hold's handles still drag across the whole
 * run and a Copy gives the words as drawn.
 *
 * The height comes from the module's synchronous measure, in the same render, from the same
 * builder the view draws with: FlashList sizes a row when it mounts, and a row that mounted at no
 * height and grew a frame later would jump under the reader.
 *
 * The module ships in the same APK as this JavaScript. Were it ever missing, every run stays a
 * React Native Text, as before.
 */
const MODULE = 'OrcaNativeProse'

type NativeProseModule = { measure(spec: string, width: number): number }

type NativeViewProps = ViewProps & {
  spec: string
  layoutWidth: number
  selectable: boolean
  onLinkPress: (event: NativeSyntheticEvent<{ link: number }>) => void
}

function loadModule(): { module: NativeProseModule; View: ComponentType<NativeViewProps> } | null {
  const module = requireOptionalNativeModule<NativeProseModule>(MODULE)
  if (module === null) {
    console.warn(`${MODULE} is not in this build: replies keep the React Native Text, with no hanging bullets`)
    return null
  }
  return { module, View: requireNativeViewManager<NativeViewProps>(MODULE) }
}

const native = loadModule()

export const NATIVE_PROSE_AVAILABLE = native !== null

/** processColor gives an Android colour int for any colour the theme writes, rgba() included. */
function toColor(color: string): number {
  const processed = processColor(color)
  return typeof processed === 'number' ? processed : 0
}

let warnedMeasure = false

export function NativeProseText({
  model,
  typography,
  textScale,
  width,
  selectable,
  onLink,
  onRefused
}: NativeProseTextProps): ReactNode {
  const { colors, fonts } = useTheme()
  const spec = useMemo(
    () => nativeProseSpec(model, { typography, scale: textScale, colors, fonts, toColor }),
    [model, typography, textScale, colors, fonts]
  )
  const density = PixelRatio.get()
  const layoutWidth = nativeProseLayoutWidth(width, density)
  // Keyed by the spec's text, so a re-render that built an equal model measures nothing again.
  const heightPx = useMemo(
    () => (native && layoutWidth > 0 ? native.module.measure(spec, layoutWidth) : -1),
    [spec, layoutWidth]
  )
  const height = nativeProseHeightDp(heightPx, density)
  const refused = native !== null && layoutWidth > 0 && height === null
  useEffect(() => {
    if (!refused) {
      return
    }
    if (!warnedMeasure) {
      warnedMeasure = true
      console.warn(`${MODULE} could not measure a run (see logcat ${MODULE}); the reply is drawn as Text`)
    }
    onRefused()
  }, [refused, onRefused])
  if (!native || height === null) {
    return null
  }
  const { View } = native
  return (
    <View
      spec={spec}
      layoutWidth={layoutWidth}
      selectable={selectable}
      onLinkPress={(event) => {
        const link = model.links[event.nativeEvent.link]
        if (link) {
          onLink(link)
        }
      }}
      style={{ height }}
    />
  )
}

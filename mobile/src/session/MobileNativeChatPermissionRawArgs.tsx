import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'
import {
  RAW_ARGS_FOLDED_COUNT,
  rawArgsFoldHides,
  rawArgsOverflowLabel,
  type PermissionRawArgs
} from './mobile-permission-raw-args'

export const RAW_ARGS_SHOW_FULL = 'Show full input'
export const RAW_ARGS_SHOW_LESS = 'Show less'

/**
 * A tool's input on the permission card, argument by argument, the Claude
 * app's raw-input face (mobile-permission-raw-args.ts). Sizes and colours are
 * Code UI's: the sunken block the card's command already sits in.
 */
export function MobileNativeChatPermissionRawArgs({
  raw,
  maxHeight
}: {
  raw: PermissionRawArgs
  /** The most of the dock the block may take; past it, it scrolls. */
  maxHeight: number
}) {
  const { colors, radius, space } = useTheme()
  const [open, setOpen] = useState(false)
  const shown = open ? raw.args : raw.args.slice(0, RAW_ARGS_FOLDED_COUNT)
  const hidden = raw.args.length - shown.length + raw.unlisted
  const toggles = rawArgsFoldHides(raw)
  return (
    <View style={{ gap: space.xs, flexShrink: 1 }} testID="native-chat-approval-raw-args">
      <ScrollView
        style={{ maxHeight, flexShrink: 1, borderRadius: radius.md, backgroundColor: colors.bgSunken }}
        nestedScrollEnabled
        contentContainerStyle={{ padding: space.md, gap: space.md }}
      >
        {shown.map((arg) => (
          <View key={arg.name} style={{ gap: 2 }}>
            <Txt variant="caption" tone="secondary" selectable>
              {arg.name}
            </Txt>
            <Txt variant="mono" selectable>
              {open ? arg.value : arg.folded}
            </Txt>
          </View>
        ))}
        {hidden > 0 ? (
          <Txt variant="caption" tone="secondary">
            {rawArgsOverflowLabel(hidden)}
          </Txt>
        ) : null}
      </ScrollView>
      {toggles ? (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel={open ? RAW_ARGS_SHOW_LESS : RAW_ARGS_SHOW_FULL}
          accessibilityState={{ expanded: open }}
          pressedScale={0.98}
          onPress={() => setOpen((value) => !value)}
          style={{ alignSelf: 'flex-start', paddingVertical: space.xs }}
        >
          <Txt variant="caption" weight="semibold" tone="accent">
            {open ? RAW_ARGS_SHOW_LESS : RAW_ARGS_SHOW_FULL}
          </Txt>
        </PressScale>
      ) : null}
    </View>
  )
}

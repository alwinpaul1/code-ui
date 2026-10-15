import { useCallback, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { COMPACTION_SQUIGGLE, compactionSquigglePath } from './compaction-squiggle'

// The Claude app's transcript divider (com.anthropic.claude 1.261009.20): `yv8.I` (yv8.java:1372-1385)
// pads it 12 dp above and below and hands the caption to `n030.e` (n030.java:404-457), a full-width
// row centred vertically with 12 dp between its parts: a rule of weight 1, the caption, a rule of
// weight 1. The caption is `jn7.K` 11 sp / 400 (jn7.java:54-55) in `pl7.w`, and each rule is the
// wavy line of compaction-squiggle.ts in the same colour. Used for "Compacted conversation" and
// "Context cleared" alike (yv8.java:10435-10442).

const ROW_GAP = 12
const ROW_PADDING_Y = 12
const CAPTION_SIZE = 11
const CAPTION_LINE = 16.5

function Squiggle(): React.JSX.Element {
  const { colors } = useTheme()
  const [width, setWidth] = useState(0)
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), [])
  return (
    <View
      testID="compaction-rule"
      onLayout={onLayout}
      style={{ flex: 1, height: COMPACTION_SQUIGGLE.height }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={COMPACTION_SQUIGGLE.height}>
        <Path
          d={compactionSquigglePath(width)}
          fill="none"
          stroke={colors.transcriptDividerInk}
          strokeWidth={COMPACTION_SQUIGGLE.strokeWidth}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  )
}

/** A caption between two wavy lines. */
export function MobileNativeChatDivider({ label }: { label: string }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      accessibilityRole="none"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: ROW_GAP, paddingVertical: ROW_PADDING_Y }}
    >
      <Squiggle />
      <Txt
        variant="caption"
        style={{ fontSize: CAPTION_SIZE, lineHeight: CAPTION_LINE, letterSpacing: 0, color: colors.transcriptDividerInk }}
      >
        {label}
      </Txt>
      <Squiggle />
    </View>
  )
}

import { memo } from 'react'
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'
import type { SyntaxPalette } from '../theme/syntax-palette'
import { MobileSyntaxSegments } from './MobileSyntaxSegments'
import type { CodeViewStyles } from './mobile-code-view-styles'

/** What a caller can wire onto one line: the file reader's line selection. */
export type MobileCodeLineInteraction = {
  /** Left undefined, the line's code stays selectable for the OS copy gesture. */
  selectable?: boolean
  highlighted?: boolean
  highlightStyle?: StyleProp<ViewStyle>
  onLongPress?: () => void
  onPress?: () => void
}

/** A line that starts a foldable block: whether it is folded, the toggle's
 *  spoken name ("Fold lines 12–40"), and what a tap does. */
export type MobileCodeLineFold = { folded: boolean; label: string; onToggle: () => void }

/**
 * One numbered line of the code viewer: the number in its own column, the
 * fold toggle (▾ open, ▸ folded) on a block's first line, then the code,
 * with a faint guide at each indent level. A folded header ends in a "…"
 * that unfolds it too. The guides come before the text in the tree, so the
 * text paints over them without a z-index.
 */
export const MobileCodeViewLine = memo(function MobileCodeViewLine({
  number,
  segments,
  guides,
  guideSpacing,
  gutterDigits,
  styles,
  palette,
  rowStyle,
  numberOfLines,
  selectable = true,
  highlighted = false,
  highlightStyle,
  onLongPress,
  onPress,
  foldColumn,
  fold
}: MobileCodeLineInteraction & {
  number: number
  segments: MobileSyntaxSegment[]
  /** Indent guides on this line. */
  guides: number
  /** Points between two guides: the indent step on the grid. */
  guideSpacing: number
  gutterDigits: number
  styles: CodeViewStyles
  palette: SyntaxPalette
  rowStyle: StyleProp<ViewStyle>
  /** 1 while unwrapped: the row is exactly one line tall. */
  numberOfLines: 1 | undefined
  /** The file has blocks to fold: every row keeps the toggles' column. */
  foldColumn: boolean
  fold?: MobileCodeLineFold
}) {
  return (
    <View style={[styles.row, rowStyle, highlighted && highlightStyle]}>
      <Text
        selectable={false}
        style={highlighted ? [styles.gutter, styles.gutterSelected] : styles.gutter}
        onLongPress={onLongPress}
        onPress={onPress}
      >
        {String(number).padStart(gutterDigits, ' ')}
      </Text>
      {fold ? (
        <Pressable
          style={styles.foldToggle}
          onPress={fold.onToggle}
          accessibilityRole="button"
          accessibilityLabel={fold.label}
          accessibilityState={{ expanded: !fold.folded }}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        >
          <Text style={highlighted ? [styles.foldGlyph, styles.foldGlyphSelected] : styles.foldGlyph}>
            {fold.folded ? '▸' : '▾'}
          </Text>
        </Pressable>
      ) : foldColumn ? (
        <View testID="code-fold-column" style={styles.foldColumn} />
      ) : null}
      <View style={styles.code}>
        {Array.from({ length: guides }, (_, level) => (
          <View
            key={level}
            testID="code-indent-guide"
            style={[styles.guide, { left: level * guideSpacing }]}
          />
        ))}
        <Text
          selectable={selectable}
          numberOfLines={numberOfLines}
          ellipsizeMode="clip"
          style={styles.codeText}
          onLongPress={onLongPress}
          onPress={onPress}
        >
          <MobileSyntaxSegments segments={segments} palette={palette} />
          {fold?.folded ? (
            <Text testID="code-fold-marker" style={styles.foldMarker} onPress={fold.onToggle}>
              {'  …'}
            </Text>
          ) : null}
        </Text>
      </View>
    </View>
  )
})

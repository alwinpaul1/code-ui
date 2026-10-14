import { StyleSheet, Text, View } from 'react-native'
import { mobileDiffPaletteForScheme } from '../source-control/mobile-diff-claude-palette'
import { typography } from '../theme/mobile-theme'
import { useThemedStyles } from '../theme/theme-context'
import type { Theme } from '../theme/theme-context'

type Props = {
  added: number
  deleted: number
}

function lines(count: number): string {
  return count === 1 ? '1 line' : `${count} lines`
}

/**
 * "+N -M" for a file (`jlc.a` and `jlc.b` in com.anthropic.claude 1.261009.20): the added count in
 * `ad5.K()`, the removed count in `ad5.u()`, 13 sp, a count of nothing not drawn. The space sits
 * with the second count and only when a first was drawn, as `jlc.b` builds it (" -" or "-").
 */
export function MobileDiffChangeStat({ added, deleted }: Props) {
  const styles = useThemedStyles(changeStatStyles)
  if (added <= 0 && deleted <= 0) {
    return null
  }
  const spoken = [
    added > 0 ? `${lines(added)} added` : null,
    deleted > 0 ? `${lines(deleted)} removed` : null
  ].filter((part): part is string => part !== null)
  return (
    <View style={styles.row} accessible accessibilityLabel={spoken.join(', ')}>
      {added > 0 ? <Text style={[styles.text, styles.added]}>{`+${added}`}</Text> : null}
      {deleted > 0 ? (
        <Text style={[styles.text, styles.deleted]}>{`${added > 0 ? ' ' : ''}-${deleted}`}</Text>
      ) : null}
    </View>
  )
}

function changeStatStyles({ scheme }: Theme) {
  const palette = mobileDiffPaletteForScheme(scheme)
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center'
    },
    text: {
      fontFamily: typography.monoFamily,
      fontSize: 13,
      lineHeight: 18
    },
    added: {
      color: palette.statAdd
    },
    deleted: {
      color: palette.statDel
    }
  })
}

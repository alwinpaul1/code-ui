import { View } from 'react-native'
import type { FileMentionCard } from './mobile-native-chat-file-mentions'
import { useFileCardStyles } from './mobile-native-chat-file-card-styles'
import { Txt } from '../ui/Txt'

/**
 * One or more files Claude Code recorded as `@"<path>"` mentions in the
 * prompt text, drawn the way the Claude app draws them: an upper-case
 * extension badge and the file's own name, no directory, no upload id
 * (docs/claude-app-parity.md item 9).
 *
 * Not tappable. The phone's file-open path (`onOpenFile`) resolves a path
 * against this worktree or a terminal's echoed cwd; a dropped upload lives
 * outside both, and the phone has no preview for its most common shapes (a
 * video is not one of `classifyMobileArtifact`'s kinds, so the open would
 * either fail or show binary bytes as text). Wiring it up needs its own
 * verified host round trip, not a guess bolted onto this card.
 */
export function MobileNativeChatFileCardRow({ cards }: { cards: FileMentionCard[] }) {
  const styles = useFileCardStyles()
  return (
    <View style={styles.row}>
      {cards.map((card, index) => (
        <View
          key={`${index}:${card.path}`}
          style={styles.card}
          accessibilityLabel={`Attached file ${card.name}`}
        >
          {card.ext ? (
            <View style={styles.badge}>
              <Txt variant="caption" weight="semibold" style={styles.badgeText}>
                {card.ext}
              </Txt>
            </View>
          ) : null}
          <Txt variant="body" weight="medium" numberOfLines={3} style={styles.name}>
            {card.name}
          </Txt>
        </View>
      ))}
    </View>
  )
}

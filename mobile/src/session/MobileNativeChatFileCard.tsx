import { Pressable, ScrollView, Text, View } from 'react-native'
import { uploadOpensOnPhone, type FileMentionCard } from './mobile-native-chat-file-mentions'
import { useFileCardStyles, type FileCardStyles } from './mobile-native-chat-file-card-styles'

/**
 * One file card as the Claude app draws it (mobile-native-chat-file-card-
 * styles.ts has the decompiled spec): the upper-case extension badge at the
 * top, the file's own name under it, no directory, no upload id.
 *
 * A card opens only when `onOpen` is given and the phone can read the file
 * (uploadOpensOnPhone): otherwise it is a plain view, so a tap does nothing
 * rather than dead-ending on an error the user cannot act on.
 */
function FileCard({
  card,
  label,
  onOpen,
  styles
}: {
  card: FileMentionCard
  label: string
  onOpen?: (path: string) => void
  styles: FileCardStyles
}) {
  const body = (
    <>
      {card.ext ? (
        <View style={styles.badge}>
          <Text numberOfLines={1} style={styles.badgeText}>
            {card.ext}
          </Text>
        </View>
      ) : null}
      <View style={styles.spacer} />
      <Text numberOfLines={3} style={styles.name}>
        {card.name}
      </Text>
    </>
  )
  if (onOpen && uploadOpensOnPhone(card)) {
    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => onOpen(card.path)}
      >
        {body}
      </Pressable>
    )
  }
  return (
    <View style={styles.card} accessibilityLabel={label}>
      {body}
    </View>
  )
}

/** Files the agent sent (SendUserFile), inside its reply. */
export function MobileNativeChatFileCardRow({
  cards,
  sent = false
}: {
  cards: FileMentionCard[]
  /** Files the agent sent (SendUserFile), not ones the user attached. */
  sent?: boolean
}) {
  const styles = useFileCardStyles()
  return (
    <View style={styles.row}>
      {cards.map((card, index) => (
        <FileCard
          key={`${index}:${card.path}`}
          card={card}
          label={`${sent ? 'Sent' : 'Attached'} file ${card.name}`}
          styles={styles}
        />
      ))}
    </View>
  )
}

/**
 * The files a sent prompt carried, drawn above its bubble as the Claude app
 * draws them: one end-aligned row that scrolls sideways when the cards do
 * not fit (m330.java:7339-7344).
 */
export function MobileNativeChatUploadCardRow({
  cards,
  onOpen
}: {
  cards: readonly FileMentionCard[]
  onOpen?: (path: string) => void
}) {
  const styles = useFileCardStyles()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.uploadScroll}
      contentContainerStyle={styles.uploadRow}
    >
      {cards.map((card, index) => (
        <FileCard
          key={`${index}:${card.path}`}
          card={card}
          label={`Attached file ${card.name}`}
          onOpen={onOpen}
          styles={styles}
        />
      ))}
    </ScrollView>
  )
}

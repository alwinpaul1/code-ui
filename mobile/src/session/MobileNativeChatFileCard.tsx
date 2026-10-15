import { useEffect, useState } from 'react'
import { Image, Pressable, ScrollView, Text, View } from 'react-native'
import type { CcrAttachmentOutcome } from './ccr-attachment-fetch'
import { uploadOpensOnPhone, type CcrAttachmentRef, type FileMentionCard } from './mobile-native-chat-file-mentions'
import { useFileCardStyles, type FileCardStyles } from './mobile-native-chat-file-card-styles'

// The device layer is loaded on first use, so the chat does not pull the sign-in store in with it
// (the same reason as loadDefaultCcrPipelineDeps in use-ccr-session-images.ts).
const openAttachment = async (ref: CcrAttachmentRef): Promise<void> => (await import('./ccr-attachment-open')).openCcrAttachment(ref)
const loadAttachment = async (ref: CcrAttachmentRef): Promise<CcrAttachmentOutcome> => (await import('./ccr-attachment-open')).loadCcrAttachmentFile(ref)

/** An attached photo as the Claude app draws it: the picture, 96 dp, rounded, loaded from
 *  Anthropic. While it loads it is an empty tile; when it cannot load it is the file card. */
function AttachmentThumb({ card, label, styles }: { card: FileMentionCard; label: string; styles: FileCardStyles }) {
  const attachment = card.attachment!
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    loadAttachment(attachment).then(
      (outcome) => {
        if (!active) {
          return
        }
        if ('uri' in outcome) {
          setUri(outcome.uri)
        } else {
          console.warn(`[ccr-attachment] ${attachment.fileUuid}: ${outcome.error}`)
          setFailed(true)
        }
      },
      () => active && setFailed(true)
    )
    return () => {
      active = false
    }
  }, [attachment.fileUuid, attachment.fileName])
  if (failed) {
    return <FileCardBody card={card} label={label} styles={styles} />
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => void openAttachment(attachment)}
    >
      {uri ? <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" /> : null}
    </Pressable>
  )
}

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
  if (card.attachment?.isImage) {
    return <AttachmentThumb card={card} label={label} styles={styles} />
  }
  return <FileCardBody card={card} label={label} onOpen={onOpen} styles={styles} />
}

function FileCardBody({
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
  if (card.attachment) {
    // Anthropic's own copy: fetched by its uuid and handed to the phone's viewer.
    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => void openAttachment(card.attachment!)}
      >
        {body}
      </Pressable>
    )
  }
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

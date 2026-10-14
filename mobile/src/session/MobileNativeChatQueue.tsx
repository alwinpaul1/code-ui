import { useRef, useState } from 'react'
import { Image, Platform, Pressable, ScrollView, View } from 'react-native'
import { Pencil } from 'lucide-react-native'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'
import { openImagePreview } from './image-preview-store'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import { canSendQueueNow } from './claude-send-queue-now'
import { tapTargetHitSlop } from '../ui/tap-target'
import { useChatTextHoldSelects, useChatTextSelectable } from '../components/chat-text-selectable-context'
import { MARKDOWN_ROOT_GUARDS_HOLDS, MarkdownSelectionRoot } from '../components/markdown-selection-copy'

/** The queue sits in the chat list's header, and FlashList inverts that list on
 *  Android with a 180° rotation of the list and of every cell. A plain
 *  ScrollView inside reads upright, but Android's nested-scroll hand-off
 *  passes the finger's unconsumed travel to the rotated parent in the child's
 *  own frame, so at the queue's edge the whole list lurched the wrong way and
 *  a swipe on a long queued message scrolled the chat, not the message
 *  (2026-09-13). Rotating the queue's scroller the same way, and its rows back,
 *  puts child and parent in one frame. Rows are drawn in reverse to read
 *  top-down. iOS inverts with a scale and is left as it was. */
const QUEUE_FLIP =
  Platform.OS === 'android' ? ({ transform: [{ rotate: '180deg' }] } as const) : null

export function MobileNativeChatQueue({
  messages,
  agent,
  onEdit,
  onSendNow,
  agentWorking = false
}: {
  messages?: readonly MobileChatQueueEntry[]
  agent?: string | null
  onEdit?: (index: number, tapped: string) => Promise<void>
  /** Claude's send-now key (2.1.275): interrupt the turn and send the queue. */
  onSendNow?: () => Promise<boolean>
  agentWorking?: boolean
}) {
  const { colors, space, radius } = useTheme()
  const scrollRef = useRef<ScrollView>(null)
  const startedAtTopRef = useRef(false)
  // The tap can wait seconds over the relay (a message still being typed, a
  // look at the screen, the key's own round trip), and a button that looked
  // untouched all that time was tapped again and again (2026-10-14).
  const [sendingNow, setSendingNow] = useState(false)
  const pressSendNow = () => {
    if (!onSendNow || sendingNow) {
      return
    }
    setSendingNow(true)
    void onSendNow().finally(() => setSendingNow(false))
  }
  // Claude can select any entry natively; Codex only recalls its latest one.
  // Claude builds without the selector report that through the editor's own
  // error, which names the flag that turns it on — silence would just repeat
  // the original complaint that queued messages cannot be edited.
  // A send the agent's box has not listed yet has no row on its screen to
  // recall, so it gets its pencil once the box lists it.
  const editable = (index: number) =>
    Boolean(onEdit) &&
    !isUnlisted(messages?.[index]) &&
    (agent === 'claude' || (agent === 'codex' && index === (messages?.length ?? 0) - 1))
  if (!messages?.length) {
    return null
  }
  return (
    <View
      style={{
        marginHorizontal: space.md,
        marginVertical: space.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        backgroundColor: colors.bgPanel
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 48,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Txt variant="label" weight="medium" tone="secondary">
            Queued
          </Txt>
          <View
            style={{
              minWidth: 22,
              paddingHorizontal: space.xs,
              paddingVertical: 2,
              alignItems: 'center',
              borderRadius: radius.xs,
              backgroundColor: colors.bgRaised
            }}
          >
            <Txt
              variant="caption"
              weight="medium"
              tone="secondary"
              accessibilityLabel={`${messages.length} queued messages`}
            >
              {messages.length}
            </Txt>
          </View>
        </View>
        {onSendNow &&
        canSendQueueNow({ agent: agent ?? null, working: agentWorking, queued: messages.length }) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send queued messages now"
            accessibilityHint="Interrupts the current turn and sends everything queued"
            accessibilityState={{ busy: sendingNow, disabled: sendingNow }}
            disabled={sendingNow}
            hitSlop={tapTargetHitSlop({ height: 32 })}
            onPress={pressSendNow}
            style={({ pressed }) => ({
              minHeight: 32,
              justifyContent: 'center',
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              opacity: pressed ? 0.7 : 1
            })}
          >
            <Txt variant="label" weight="medium" tone={sendingNow ? 'secondary' : 'accent'}>
              {sendingNow ? 'Sending…' : 'Send now'}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        ref={scrollRef}
        style={[{ maxHeight: 220 }, QUEUE_FLIP]}
        contentContainerStyle={{ paddingHorizontal: space.md }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          // Flipped: offset 0 is the visual bottom, so start at the top once.
          if (QUEUE_FLIP && !startedAtTopRef.current) {
            startedAtTopRef.current = true
            scrollRef.current?.scrollToEnd({ animated: false })
          }
        }}
      >
        {(QUEUE_FLIP ? messages.toReversed() : messages).map((entry, listIndex) => {
          const index = QUEUE_FLIP ? messages.length - 1 - listIndex : listIndex
          const text = typeof entry === 'string' ? entry : entry.text
          const images = typeof entry === 'string' ? [] : entry.images
          // What the recall matches against is the row on screen, never the
          // caption a photo row shows in its place.
          const drawn = typeof entry === 'string' ? entry : entry.caption
          const parsed = splitOrcaPastedImagePaths(text)
          const canEdit = editable(index)
          const rowStyle = [
            {
              flexDirection: 'row' as const,
              alignItems: 'flex-start' as const,
              gap: space.sm,
              paddingVertical: space.md,
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: colors.border
            },
            QUEUE_FLIP
          ]
          // The whole row is the button, as the Claude app's queued bubble is
          // (1.261009.20: hb20.e clickable, z07 -> dequeueToInput): the tap
          // brings the message back to the composer from the agent's input.
          const Row = canEdit ? Pressable : View
          return (
            <Row
              key={`${index}:${text}`}
              {...(canEdit
                ? {
                    accessibilityRole: 'button' as const,
                    accessibilityLabel: `Edit queued message ${index + 1}`,
                    accessibilityHint: 'Moves it back into the message box',
                    onPress: () => void onEdit?.(index, drawn)
                  }
                : {})}
              style={rowStyle}
            >
              <Txt
                variant="caption"
                tone="muted"
                accessibilityLabel={`Message ${index + 1}`}
                style={{ minWidth: 16, paddingTop: 3 }}
              >
                {index + 1}
              </Txt>
              {images.length ? (
                // Several photos scroll sideways, as they do in the sent bubble
                // (2026-09-13); one stays a single thumbnail.
                <QueuedImages images={images} index={index} />
              ) : null}
              <View style={{ flex: 1, gap: space.xs }}>
                {parsed.text && canEdit ? (
                  // Not selectable where a tap edits it: a selectable Text takes the row's press.
                  <Txt variant="body">{parsed.text}</Txt>
                ) : parsed.text ? (
                  // The queue is in the chat list's header, so the finger that scrolls the
                  // transcript lands here too; the scroll's guard against a stray hold covers
                  // these words as it covers a reply's (QueuedWords).
                  <QueuedWords text={parsed.text} />
                ) : null}
                {!images.length && parsed.paths.length ? (
                  <Txt variant="caption" tone="secondary">
                    {`${parsed.paths.length} attached image${parsed.paths.length === 1 ? '' : 's'}`}
                  </Txt>
                ) : null}
              </View>
              {canEdit ? (
                // The row's own mark that it edits; the tap is the row's.
                <View
                  pointerEvents="none"
                  style={{ minHeight: 24, minWidth: 24, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Pencil size={16} color={colors.textSecondary} />
                </View>
              ) : null}
            </Row>
          )
        })}
      </ScrollView>
    </View>
  )
}

/**
 * A queued message's words, selectable as a reply's are. On Android they sit in the document's
 * selection root, which stops a hold starting a selection while the list scrolls and leaves one
 * already open alone (SelectionCopyRootView.applyHoldSelects), so the words stay selectable
 * throughout. Without the root, `selectable` itself is the guard. Before this, the queue was the
 * one text in the chat list a scroll never guarded: a finger that caught a fling on a queued
 * message started a selection in it (2026-10-15, 0.9.147).
 */
function QueuedWords({ text }: { text: string }) {
  const selectableNow = useChatTextSelectable()
  const holdsSelect = useChatTextHoldSelects()
  return (
    <MarkdownSelectionRoot holdSelects={selectableNow && holdsSelect}>
      <View>
        <Txt variant="body" selectable={MARKDOWN_ROOT_GUARDS_HOLDS || selectableNow}>
          {text}
        </Txt>
      </View>
    </MarkdownSelectionRoot>
  )
}

function isUnlisted(entry: MobileChatQueueEntry | undefined): boolean {
  return typeof entry === 'object' && entry.unlisted === true
}

function QueuedImages({ images, index }: { images: string[]; index: number }) {
  const { space, radius } = useTheme()
  const tiles = images.map((uri, imageIndex) => (
    <Pressable
      key={`${imageIndex}:${uri}`}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Preview image ${imageIndex + 1} in queued message ${index + 1}`}
      onPress={() =>
        images.length > 1
          ? openImagePreview(images, 'Queued image', imageIndex)
          : openImagePreview(uri, 'Queued image')
      }
    >
      <Image
        source={{ uri }}
        resizeMode="cover"
        style={{ width: 48, height: 64, borderRadius: radius.sm }}
      />
    </Pressable>
  ))
  if (images.length === 1) {
    return <View style={{ width: 48 }}>{tiles}</View>
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ maxWidth: 156, flexGrow: 0 }}
      contentContainerStyle={{ gap: space.xs }}
      testID="queued-image-strip"
    >
      {tiles}
    </ScrollView>
  )
}

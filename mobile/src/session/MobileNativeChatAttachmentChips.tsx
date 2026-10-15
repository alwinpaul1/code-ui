import { Film, RotateCcw, X } from 'lucide-react-native'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import type { NativeChatVideoFrameExtractionState } from './mobile-native-chat-image-attachments-store'
import { openImagePreview } from './image-preview-store'
import { retryNativeChatUpload } from './mobile-native-chat-upload-retry'
import { moveNativeChatAttachment } from './mobile-native-chat-attachment-order'
import { useFileCardStyles } from './mobile-native-chat-file-card-styles'
import { splitAttachmentName } from './mobile-native-chat-file-mentions'

/**
 * A chip as the Claude app draws one in the Code composer (com.anthropic.claude 1.261009.20,
 * decompiled): `l7s.a` lays the strip out as a LazyRow 12 dp apart, and each chip is `l7f.d` at
 * 96 dp (`cxe.c`, cxe.java:340/497), the same body as the card above a sent prompt
 * (mobile-native-chat-file-card-styles.ts): a photo fills a 96 dp square clipped to 16 dp, cropped;
 * a document is the bordered card with its extension badge at the top and its name at the bottom.
 * While it uploads, an indeterminate ring (`yfi.f`, 32 dp, `pl7.e`) sits over the photo's centre, or
 * at the card's bottom end beside the name, with no scrim. A failed upload is a red disc there
 * instead (`l7f.a`: `pl7.A` at 0.8 alpha, 6 dp padding). Remove is an 18 dp disc in `pl7.O` at the
 * top end, 4 dp in, its cross in `pl7.p`, in every state. One addition: the red disc is a retry
 * here (the app has none on the chip), since this lane can send the file again.
 */
const CHIP = 96
const STRIP_GAP = 12
const RING = 32
/** The remove disc's touch target: 48 dp, Android's minimum, centred where the app draws its 18 dp
 *  disc (4 dp in from the chip's top end, so 13 dp to its centre). The holder reaches 24 - 13 = 11
 *  dp past the chip's top and end to take it, and gives that back with a negative margin, so the
 *  strip's layout is unchanged; 11 fits inside the strip's 12 dp gap and top padding. */
const REMOVE_TOUCH = 48
const REMOVE_REACH = REMOVE_TOUCH / 2 - (4 + 9)
const REMOVE_HOLDER = { paddingTop: REMOVE_REACH, paddingRight: REMOVE_REACH, marginTop: -REMOVE_REACH, marginRight: -REMOVE_REACH }
const REMOVE_TARGET = { position: 'absolute', top: 0, right: 0, width: REMOVE_TOUCH, height: REMOVE_TOUCH, alignItems: 'center', justifyContent: 'center' } as const

/** "Move earlier" / "Move later" where the chip can go, the Claude app's
 *  screen-reader reorder (ccr_reorder_move_earlier_a11y / _later_a11y). */
function reorderActions(index: number, count: number): { name: string; label: string }[] {
  return [
    ...(index > 0 ? [{ name: 'moveEarlier', label: 'Move earlier' }] : []),
    ...(index < count - 1 ? [{ name: 'moveLater', label: 'Move later' }] : [])
  ]
}

function onReorderAction(id: string) {
  return (event: { nativeEvent: { actionName: string } }): void => {
    if (event.nativeEvent.actionName === 'moveEarlier') {
      moveNativeChatAttachment(id, 'earlier')
    } else if (event.nativeEvent.actionName === 'moveLater') {
      moveNativeChatAttachment(id, 'later')
    }
  }
}

/** The strip above the composer text: image thumbnails and named document
 *  chips, each with its remove badge, plus (while a document attach is
 *  reading an over-the-cap video) one progress chip ahead of them all. */
export function MobileNativeChatAttachmentChips({
  attachments,
  onRemoveAttachment,
  onEditAttachment,
  videoFrameExtraction,
  onCancelVideoFrameExtraction
}: {
  attachments: readonly PendingNativeChatImage[]
  onRemoveAttachment?: (id: string) => void
  /** Opens the markup editor on a photo chip, from the pencil in the
   *  full-screen preview a tap on the photo opens. The chip itself carries no
   *  pencil (2026-09-24). Never used for a document chip, which has nothing
   *  to draw on. */
  onEditAttachment?: (id: string, uri: string) => void
  /** An over-the-cap video's frames are still being read — "Reading frames
   *  5/20…", cancellable. Not one of `attachments`: it is drawn beside them
   *  so it can never be mistaken for a chip a send is waiting on
   *  (`mobile-native-chat-image-attachments-store.ts`). */
  videoFrameExtraction?: NativeChatVideoFrameExtractionState | null
  onCancelVideoFrameExtraction?: () => void
}) {
  const { colors, space } = useTheme()
  const cardStyles = useFileCardStyles()
  if (attachments.length === 0 && !videoFrameExtraction) {
    return null
  }
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={{ maxHeight: CHIP + space.md }}
      contentContainerStyle={{
        gap: STRIP_GAP,
        paddingHorizontal: space.md,
        paddingTop: space.md
      }}
    >
      {videoFrameExtraction ? (
        <View
          style={{
            height: CHIP,
            maxWidth: 210,
            paddingRight: 26,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.bgRaised
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              paddingLeft: space.sm
            }}
          >
            <Film size={20} color={colors.textSecondary} strokeWidth={1.8} />
            <Txt variant="caption" weight="medium" numberOfLines={2} style={{ maxWidth: 140 }}>
              {videoFrameExtraction.total === null
                ? 'Reading a video…'
                : `Reading frames ${videoFrameExtraction.done}/${videoFrameExtraction.total}…`}
            </Txt>
          </View>
          {onCancelVideoFrameExtraction ? (
            <Pressable
              accessibilityLabel="Cancel reading frames"
              style={{
                position: 'absolute',
                top: 3,
                right: 3,
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.text
              }}
              onPress={onCancelVideoFrameExtraction}
              hitSlop={8}
            >
              <X size={12} color={colors.textInverse} strokeWidth={2.6} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {attachments.map((attachment, index) => {
        const isFile = attachment.kind === 'file'
        const reorderable = reorderActions(index, attachments.length)
        const fileName = attachment.name ?? 'File'
        // The app's own split (p530): base name over the extension badge; a dotfile keeps its name.
        const { stem: splitStem, ext } = splitAttachmentName(fileName)
        const stem = splitStem || fileName
        // Still on its way up, the ring; its bytes never arrived, the red disc (a retry here). Over a
        // photo's centre with no scrim, so the picture stays visible; at a document's bottom end.
        const statePlacement = isFile
          ? {}
          : { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center' as const, justifyContent: 'center' as const }
        const state = attachment.uploading ? (
          <View pointerEvents="none" importantForAccessibility="no" accessibilityLabel="Uploading" testID="attachment-uploading" style={statePlacement}>
            <ActivityIndicator size={RING} color={colors.composerSend} />
          </View>
        ) : attachment.failed ? (
          // The retry is kept by chip id (mobile-native-chat-upload-retry.ts).
          <View pointerEvents="box-none" importantForAccessibility="no" accessibilityLabel="Upload failed" style={statePlacement}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry upload"
              style={{ padding: 6, borderRadius: 999, opacity: 0.8, backgroundColor: colors.danger }}
              onPress={() => void retryNativeChatUpload(attachment.id)}
              hitSlop={8}
            >
              <RotateCcw size={16} color={colors.onDanger} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : null
        // TalkBack reads the state in the chip's own label: the ring and the red disc are not
        // focusable, and Retry and Remove are buttons of their own beside it, never inside it.
        const stateWord = attachment.uploading ? ', uploading' : attachment.failed ? ', upload failed' : ''
        return (
          <View key={attachment.id} style={REMOVE_HOLDER}>
            <View style={isFile ? cardStyles.card : cardStyles.thumb}>
              {isFile ? (
                <View style={{ flex: 1 }}>
                  {ext ? (
                    <View style={cardStyles.badge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                      <Text numberOfLines={1} ellipsizeMode="tail" style={cardStyles.badgeText}>
                        {ext}
                      </Text>
                    </View>
                  ) : null}
                  <View style={cardStyles.spacer} />
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                    <View
                      accessible
                      accessibilityLabel={`${fileName}${stateWord}`}
                      accessibilityActions={reorderable}
                      onAccessibilityAction={onReorderAction(attachment.id)}
                      style={{ flex: 1 }}
                    >
                      <Text numberOfLines={3} style={cardStyles.name}>
                        {stem}
                      </Text>
                    </View>
                    {state}
                  </View>
                </View>
              ) : (
                // A tap opens the photo full-screen, the way the Claude app does,
                // and markup is the pencil there (2026-09-26; from 360ef269 a tap
                // went straight into markup). No pencil while an upload has not
                // settled, with no editor to hand, or on a video frame: its
                // preview is a small copy kept only for the chip strip, and the
                // pencil's re-upload would silently replace the real, full-size
                // frame the desktop already has with that small copy
                // (2026-09-27 review).
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Preview image${stateWord}`}
                  accessibilityActions={reorderable}
                  onAccessibilityAction={onReorderAction(attachment.id)}
                  style={{ flex: 1 }}
                  onPress={() =>
                    openImagePreview(
                      attachment.previewUri,
                      attachment.name ?? 'Image',
                      0,
                      onEditAttachment && !attachment.uploading && !attachment.failed && !attachment.videoFrame
                        ? () => onEditAttachment(attachment.id, attachment.previewUri)
                        : undefined
                    )
                  }
                >
                  <Image source={{ uri: attachment.previewUri }} style={cardStyles.thumbImage} resizeMode="cover" />
                </Pressable>
              )}
              {isFile ? null : state}
            </View>
            {onRemoveAttachment ? (
              // In every state, uploading too, as the Claude app draws it: a file on its way up can
              // still be taken back. After the chip in the tree, so it paints over it, and outside
              // it, so the chip's clip never cuts the 48 dp target down (Android also drops touches
              // outside a parent's bounds, which is why it is a box and not a hitSlop).
              <Pressable
                // The Claude app's words for it (ccr_remove_attachment).
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
                style={REMOVE_TARGET}
                onPress={() => onRemoveAttachment(attachment.id)}
              >
                <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }}>
                  <X size={12} color={colors.attachmentCardFill} strokeWidth={2.6} />
                </View>
              </Pressable>
            ) : null}
          </View>
        )
      })}
    </ScrollView>
  )
}

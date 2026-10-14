import { Image, Pressable, ScrollView, View } from 'react-native'
import { useSyncExternalStore } from 'react'
import type { NativeChatImageRefBlock } from '../../../src/shared/native-chat-types'
import { openImagePreview } from './image-preview-store'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'
import { hostImageMissing, subscribeHostImageMissing } from './host-image-refusals'
import { MobileNativeChatAgentImageLoadingTile } from './MobileNativeChatImageStrip'
import { AgentImagePlaceholder, fileName } from './MobileNativeChatProse'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { space } from '../theme/tokens'

/**
 * Two or more pictures an agent read or sent, while at least one is still on
 * its way: one sideways row of 96 dp tiles, as the Claude app lays them out,
 * with a loading tile holding each missing picture's place. A picture the
 * desktop will not send leaves the row and becomes the chip that names it,
 * under the row, where a tap says why. A tap on a loaded tile opens the
 * viewer on it, the other loaded pictures a swipe away.
 */
export function MobileNativeChatAgentImageRow({
  slots,
  fontScale,
  styles
}: {
  slots: readonly NativeChatImageRefBlock[]
  fontScale: number
  styles: ChatMessageStyles
}) {
  // One string, so the row redraws when any of its pictures gets an answer.
  const missing = useSyncExternalStore(subscribeHostImageMissing, () =>
    slots.map((slot) => (isRenderableImageUri(slot.url) ? '' : (hostImageMissing(slot.path) ?? ''))).join('\n')
  ).split('\n')
  const inRow = slots.filter((_, index) => !missing[index])
  const chips = slots.filter((_, index) => Boolean(missing[index]))
  const loaded = inRow.map((slot) => slot.url).filter(isRenderableImageUri)
  const label = slots[0]?.alt ?? 'Image'
  return (
    <View style={{ gap: space.sm }}>
      {inRow.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Fixed height, as MobileNativeChatImageStrip explains: a nested
          // scroller re-measured mid-scroll made the list row jump.
          style={styles.imageStripFrame}
          contentContainerStyle={styles.imageStrip}
          removeClippedSubviews={false}
          nestedScrollEnabled
          testID="chat-agent-image-row"
        >
          {inRow.map((slot, index) => {
            const uri = isRenderableImageUri(slot.url) ? slot.url : undefined
            if (!uri) {
              return (
                <MobileNativeChatAgentImageLoadingTile
                  key={`w${index}:${slot.path ?? ''}`}
                  path={slot.path}
                  name={fileName(slot.path)}
                />
              )
            }
            const at = loaded.indexOf(uri)
            return (
              <Pressable
                key={`l${index}:${uri.slice(0, 40)}`}
                onPress={() => openImagePreview(loaded, label, at)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${label} ${at + 1} of ${loaded.length}`}
              >
                <Image source={{ uri }} style={styles.imageTile} resizeMode="cover" />
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
      {chips.map((slot, index) => (
        <AgentImagePlaceholder key={`c${index}:${slot.path ?? ''}`} path={slot.path} fontScale={fontScale} styles={styles} />
      ))}
    </View>
  )
}

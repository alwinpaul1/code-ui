import { Image, Modal, Pressable, ScrollView, StatusBar, useWindowDimensions, View } from 'react-native'
import { X } from 'lucide-react-native'
import { closeImagePreview, setImagePreviewIndex, useImagePreview } from '../session/image-preview-store'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** Full-screen viewer for an image the chat already holds (a phone upload's
 *  local file, or a host thumbnail already fetched). Tap anywhere or the X to
 *  close. Dark scrim in both themes, like the Claude app's viewer. */
export function ImagePreviewModal(): React.JSX.Element | null {
  const preview = useImagePreview()
  const { width } = useWindowDimensions()
  const { colors, space } = useTheme()
  if (!preview) {
    return null
  }
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeImagePreview}
    >
      <StatusBar barStyle="light-content" />
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}
        onPress={closeImagePreview}
        accessibilityRole="button"
        accessibilityLabel="Close image preview"
      >
        {/* The close button owns a bar of its own above the picture, so it
            never sits on top of the image. */}
        <View
          style={{
            height: space.xl + space.lg + 40 + space.md,
            paddingTop: space.xl + space.lg,
            paddingRight: space.md,
            alignItems: 'flex-end',
            justifyContent: 'flex-start'
          }}
        >
          <Pressable
            onPress={closeImagePreview}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)'
            })}
          >
            <X size={20} color="#fff" strokeWidth={2.2} />
          </Pressable>
        </View>
        {/* Why a paged ScrollView: the Claude app's viewer swipes through the
            message's images and counts them ("5 of 6", 2026-09-12). */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentOffset={{ x: preview.index * width, y: 0 }}
          onMomentumScrollEnd={(event) =>
            setImagePreviewIndex(Math.round(event.nativeEvent.contentOffset.x / width))
          }
        >
          {preview.uris.map((uri, index) => (
            <Image
              key={`${index}:${uri.slice(0, 40)}`}
              source={{ uri }}
              style={{ width, height: '100%' }}
              resizeMode="contain"
              accessibilityLabel={`${preview.label} ${index + 1} of ${preview.uris.length}`}
            />
          ))}
        </ScrollView>
        <View style={{ paddingVertical: space.lg + space.md }}>
          <Txt
            variant="caption"
            align="center"
            style={{ color: colors.textInverse === '#fff' ? '#fff' : 'rgba(255,255,255,0.8)' }}
          >
            {preview.uris.length > 1 ? `${preview.index + 1} of ${preview.uris.length}` : preview.label}
          </Txt>
        </View>
      </Pressable>
    </Modal>
  )
}

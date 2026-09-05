import { Image, Modal, Pressable, StatusBar, useWindowDimensions, View } from 'react-native'
import { X } from 'lucide-react-native'
import { closeImagePreview, useImagePreview } from '../session/image-preview-store'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** Full-screen viewer for an image the chat already holds (a phone upload's
 *  local file, or a host thumbnail already fetched). Tap anywhere or the X to
 *  close. Dark scrim in both themes, like the Claude app's viewer. */
export function ImagePreviewModal(): React.JSX.Element | null {
  const preview = useImagePreview()
  const { width, height } = useWindowDimensions()
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
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' }}
        onPress={closeImagePreview}
        accessibilityRole="button"
        accessibilityLabel="Close image preview"
      >
        <Image
          source={{ uri: preview.uri }}
          style={{ width, height: height * 0.82, alignSelf: 'center' }}
          resizeMode="contain"
          accessibilityLabel={preview.label}
        />
        <View
          style={{
            position: 'absolute',
            top: space.xl + space.lg,
            right: space.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm
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
        <View style={{ position: 'absolute', bottom: space.xl + space.lg, left: 0, right: 0 }}>
          <Txt
            variant="caption"
            align="center"
            style={{ color: colors.textInverse === '#fff' ? '#fff' : 'rgba(255,255,255,0.8)' }}
          >
            {preview.label}
          </Txt>
        </View>
      </Pressable>
    </Modal>
  )
}

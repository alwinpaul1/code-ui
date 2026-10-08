import { useMemo, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Copy, TextCursor, X } from 'lucide-react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ActionSheetContent } from '../components/ActionSheetModal'
import { BottomDrawer } from '../components/BottomDrawer'
import { useClipboardWriter } from '../platform/clipboard'
import { useTheme, type Theme } from '../theme/theme-context'
import { nativeChatMessagePlainText } from './mobile-native-chat-message-plain-text'

type Props = {
  /** The long-pressed message. The owner mounts this only while the sheet is open. */
  message: NativeChatMessage
  onClose: () => void
}

/** Orca #22871: Android draws the chat transcript with no inline selection, so
 *  a long press on a message offers its copy here instead. Upstream's icon for
 *  "Select text" is lucide's TextSelect, which this fork's lucide does not
 *  ship; TextCursor stands in. */
export function MobileNativeChatMessageActionsSheet({
  message,
  onClose
}: Props): React.JSX.Element {
  const clipboard = useClipboardWriter()
  const [sheetVisible, setSheetVisible] = useState(true)
  const [selecting, setSelecting] = useState(false)
  // Wait for the drawer to unmount before presenting another native modal.
  const selectRequested = useRef(false)
  // Streaming updates must not reset an active native text selection.
  const [text] = useState(() => nativeChatMessagePlainText(message))
  const closeSheet = () => setSheetVisible(false)

  return (
    <>
      <BottomDrawer
        visible={sheetVisible}
        onClose={closeSheet}
        onAfterClose={() => (selectRequested.current ? setSelecting(true) : onClose())}
        dragContentToDismiss
      >
        <ActionSheetContent
          onClose={closeSheet}
          actions={[
            {
              label: 'Copy message',
              icon: Copy,
              disabled: text.length === 0,
              onPress: () => {
                void clipboard.writeText(text).catch((error: unknown) => {
                  Alert.alert(
                    'Copy failed',
                    error instanceof Error ? error.message : 'The clipboard rejected the text.'
                  )
                })
              }
            },
            {
              label: 'Select text',
              icon: TextCursor,
              disabled: text.length === 0,
              onPress: () => {
                selectRequested.current = true
              }
            }
          ]}
        />
      </BottomDrawer>
      {selecting ? <SelectTextScreen text={text} onClose={onClose} /> : null}
    </>
  )
}

function SelectTextScreen({
  text,
  onClose
}: {
  text: string
  onClose: () => void
}): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const theme = useTheme()
  // The live theme, not a fixed palette: this screen is a whole canvas.
  const styles = useMemo(() => makeStyles(theme), [theme])
  return (
    // Translucent like the fork's other full-screen modals, so the insets
    // padded below are the only top gap.
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Select text</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="Close"
            accessibilityRole="button"
            style={styles.close}
          >
            <X size={20} color={theme.colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text selectable style={styles.text}>
            {text}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

function makeStyles({ colors, space, type, fonts }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    title: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: type.heading.size,
      lineHeight: type.heading.lineHeight
    },
    close: { padding: space.xs },
    body: { padding: space.lg },
    text: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: type.body.size,
      lineHeight: 22
    }
  })
}

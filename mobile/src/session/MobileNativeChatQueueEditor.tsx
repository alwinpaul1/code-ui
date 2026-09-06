import { Modal, Pressable, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'
import type { InlineQueueEditor } from './use-mobile-native-chat-queue-editor'

export function MobileNativeChatQueueEditor({ editor }: { editor?: InlineQueueEditor | null }) {
  const { colors, space, radius, type, fonts } = useTheme()
  if (!editor) {
    return null
  }
  return (
    <Modal
      transparent
      animationType="none"
      visible
      onRequestClose={() => {
        if (!editor.busy) {
          void editor.cancel()
        }
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.bgOverlay }}
      >
        <View
          style={{
            padding: space.lg,
            paddingBottom: space.xl,
            gap: space.md,
            backgroundColor: colors.bgPanel,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border
          }}
        >
          <Txt variant="heading" weight="semibold">
            Edit queued message
          </Txt>
          <TextInput
            accessibilityLabel="Queued message text"
            multiline
            autoFocus
            editable={!editor.busy}
            value={editor.text}
            onChangeText={editor.setText}
            style={{
              minHeight: 120,
              maxHeight: 300,
              textAlignVertical: 'top',
              color: colors.text,
              backgroundColor: colors.bgSunken,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              borderRadius: radius.md,
              padding: space.md,
              fontFamily: fonts.regular,
              fontSize: type.body.size,
              lineHeight: type.body.lineHeight
            }}
            selectionColor={colors.accent}
          />
          {editor.error ? (
            <View style={{ gap: space.sm }}>
              <Txt tone="danger" accessibilityRole="alert">
                {editor.error}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close queue editor"
                disabled={editor.busy}
                onPress={editor.dismiss}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Txt>Close</Txt>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save queued message"
            disabled={editor.busy || !editor.text.trim()}
            onPress={() => void editor.save()}
            style={({ pressed }) => ({
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              backgroundColor: colors.accent,
              opacity: editor.busy || !editor.text.trim() ? 0.5 : pressed ? 0.8 : 1
            })}
          >
            <Txt style={{ color: colors.onAccent }} weight="semibold">
              {editor.busy ? 'Please wait…' : 'Save'}
            </Txt>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel queue edit"
              disabled={editor.busy}
              onPress={() => void editor.cancel()}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.border : colors.bgRaised,
                opacity: editor.busy ? 0.5 : 1
              })}
            >
              <Txt>Cancel</Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete queued message"
              disabled={editor.busy}
              onPress={() => void editor.remove()}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.dangerSoft : 'transparent',
                opacity: editor.busy ? 0.5 : 1
              })}
            >
              <Txt tone="danger">Delete message</Txt>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

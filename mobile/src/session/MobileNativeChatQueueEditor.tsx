import { Modal, Pressable, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'
import type { InlineQueueEditor } from './use-mobile-native-chat-queue-editor'

export function MobileNativeChatQueueEditor({ editor }: { editor?: InlineQueueEditor | null }) {
  const { colors, space, radius, type } = useTheme()
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
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }}
      >
        <View
          style={{
            padding: space.lg,
            paddingBottom: space.xl,
            gap: space.md,
            backgroundColor: colors.bgPanel,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg
          }}
        >
          <Txt weight="semibold">Edit queued message</Txt>
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
              backgroundColor: colors.bgRaised,
              borderRadius: radius.md,
              padding: space.md,
              fontSize: type.body.size
            }}
            selectionColor={colors.accent}
          />
          {editor.error ? (
            <View style={{ gap: space.sm }}>
              <Txt accessibilityRole="alert">{editor.error}</Txt>
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
            style={{
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              backgroundColor: colors.accent,
              opacity: editor.busy || !editor.text.trim() ? 0.5 : 1
            }}
          >
            <Txt style={{ color: colors.onAccent }} weight="semibold">
              {editor.busy ? 'Saving…' : 'Save'}
            </Txt>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel queue edit"
              disabled={editor.busy}
              onPress={() => void editor.cancel()}
              style={{
                flex: 1,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                backgroundColor: colors.bgRaised
              }}
            >
              <Txt>Cancel</Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete queued message"
              disabled={editor.busy}
              onPress={() => void editor.remove()}
              style={{
                flex: 1,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                backgroundColor: colors.bgRaised
              }}
            >
              <Txt>Delete message</Txt>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

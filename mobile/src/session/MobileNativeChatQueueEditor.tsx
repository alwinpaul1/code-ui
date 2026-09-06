import { useRef } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform
} from 'react-native'
import { Check, Trash2, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Txt } from '../ui/Txt'
import { useTheme } from '../theme/theme-context'
import type { InlineQueueEditor } from './use-mobile-native-chat-queue-editor'

export function MobileNativeChatQueueEditor({ editor }: { editor?: InlineQueueEditor | null }) {
  const { colors, space, radius, type, fonts } = useTheme()
  const insets = useSafeAreaInsets()
  const inputRef = useRef<TextInput>(null)
  if (!editor) {
    return null
  }
  const cancel = () => {
    if (!editor.busy) {
      void editor.cancel()
    }
  }
  const saveDisabled = editor.busy || editor.text.trim().length === 0
  return (
    <Modal
      transparent
      animationType="none"
      visible
      onShow={() => inputRef.current?.focus()}
      onRequestClose={cancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.bgOverlay }}
      >
        <View
          style={{
            maxHeight: '90%',
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.lg),
            backgroundColor: colors.bgPanel,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderWidth: 1,
            borderColor: colors.border
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingLeft: space.lg,
              paddingRight: space.sm,
              paddingBottom: space.sm
            }}
          >
            <Txt variant="heading" weight="semibold" style={{ flex: 1 }}>
              Edit queued message
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel queue edit"
              accessibilityState={{ disabled: editor.busy, busy: editor.busy }}
              disabled={editor.busy}
              onPress={cancel}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.pill,
                backgroundColor: pressed ? colors.bgRaised : 'transparent'
              })}
            >
              {editor.busy ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <X size={20} color={colors.textSecondary} />
              )}
            </Pressable>
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{
              paddingHorizontal: space.lg,
              paddingBottom: space.lg,
              gap: space.md
            }}
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              ref={inputRef}
              accessibilityLabel="Queued message text"
              multiline
              autoFocus
              editable={!editor.busy}
              value={editor.text}
              onChangeText={editor.setText}
              style={{
                minHeight: 140,
                maxHeight: 260,
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
          </ScrollView>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              borderTopWidth: 1,
              borderTopColor: colors.border
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete queued message"
              disabled={editor.busy}
              onPress={() => void editor.remove()}
              style={({ pressed }) => ({
                minWidth: 44,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm,
                backgroundColor: pressed ? colors.dangerSoft : 'transparent',
                opacity: editor.busy ? 0.5 : 1
              })}
            >
              <Trash2 size={19} color={colors.danger} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel changes to queued message"
              disabled={editor.busy}
              onPress={cancel}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: space.md,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm,
                backgroundColor: pressed ? colors.bgRaised : 'transparent',
                opacity: editor.busy ? 0.5 : 1
              })}
            >
              <Txt weight="medium" tone="secondary">
                Cancel
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save queued message"
              accessibilityState={{ disabled: saveDisabled, busy: editor.busy }}
              disabled={saveDisabled}
              onPress={() => void editor.save()}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: space.lg,
                flexDirection: 'row',
                gap: space.xs,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm,
                backgroundColor: colors.accent,
                opacity: saveDisabled ? 0.5 : pressed ? 0.8 : 1
              })}
            >
              <Check size={17} color={colors.onAccent} />
              <Txt tone="onAccent" weight="semibold">
                Save
              </Txt>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

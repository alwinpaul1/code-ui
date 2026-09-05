import { useState } from 'react'
import { ActivityIndicator, Pressable } from 'react-native'
import { Image as ImageIcon, Mic, Paperclip, Plus } from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { VoiceLevelBars } from '../components/VoiceLevelBars'
import { useTheme } from '../theme/theme-context'

type DictationState = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
  /** Microphone level 0..1 from the on-phone recognizer; absent for desktop dictation. */
  readonly level?: number
}

type MobileTerminalInputActionsProps = {
  readonly canSend: boolean
  readonly isAttaching: boolean
  readonly dictation: DictationState
  readonly dictationMode: 'toggle' | 'hold'
  readonly onAttachImage: () => void
  /** Any document via the system file picker. */
  readonly onAttachFile: () => void
  readonly onDictationToggle: () => void
  readonly onDictationPressIn: () => void
  readonly onDictationPressOut: () => void
  readonly onDictationCancel: () => void
}

// Image + mic peer actions shared by the live and buffered input bars so both
// surfaces offer identical multimodal entry points (and the JSX lives once).
export function MobileTerminalInputActions({
  canSend,
  isAttaching,
  dictation,
  dictationMode,
  onAttachImage,
  onAttachFile,
  onDictationToggle,
  onDictationPressIn,
  onDictationPressOut,
  onDictationCancel
}: MobileTerminalInputActionsProps) {
  const { colors } = useTheme()
  const [showAttachSheet, setShowAttachSheet] = useState(false)
  const dictationActive = dictation.isStarting || dictation.isRecording
  const buttonStyle = (disabled: boolean, active = false) => ({
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: active ? colors.dangerSoft : 'transparent',
    opacity: disabled ? 0.4 : 1
  })
  return (
    <>
      <Pressable
        style={buttonStyle(!canSend || isAttaching)}
        disabled={!canSend || isAttaching}
        // Same chooser as the chat composer: Photos or Files. Uploads via host
        // RPC so SSH/remote sessions attach the same as local ones.
        onPress={() => setShowAttachSheet(true)}
        accessibilityLabel={isAttaching ? 'Sending attachment' : 'Add to terminal'}
      >
        {isAttaching ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <Plus size={20} color={colors.textSecondary} strokeWidth={2.2} />
        )}
      </Pressable>
      <ActionSheetModal
        visible={showAttachSheet}
        title="Add to terminal"
        actions={[
          {
            label: 'Photos',
            hint: 'Pick from your photo library',
            icon: ImageIcon,
            onPress: onAttachImage
          },
          {
            label: 'Files',
            hint: 'PDF, documents, code, anything on this phone',
            icon: Paperclip,
            onPress: onAttachFile
          }
        ]}
        onClose={() => setShowAttachSheet(false)}
      />
      {dictation.isRecording && dictation.level !== undefined ? (
        <VoiceLevelBars level={dictation.level} />
      ) : null}
      <Pressable
        style={buttonStyle(!canSend, dictationActive)}
        disabled={!canSend}
        onPress={dictationMode === 'toggle' ? onDictationToggle : undefined}
        onPressIn={dictationMode === 'hold' ? onDictationPressIn : undefined}
        onPressOut={dictationMode === 'hold' ? onDictationPressOut : undefined}
        onLongPress={
          dictationMode === 'toggle'
            ? () => {
                if (dictation.isRecording || dictation.isProcessing) {
                  onDictationCancel()
                }
              }
            : undefined
        }
        accessibilityLabel={
          dictation.isRecording
            ? 'Stop voice dictation'
            : dictation.isProcessing
              ? 'Cancel voice dictation'
              : dictation.isStarting
                ? 'Starting voice dictation'
                : 'Start voice dictation'
        }
      >
        {dictation.isProcessing ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <Mic
            size={18}
            color={dictationActive ? colors.danger : colors.textSecondary}
            strokeWidth={2.2}
          />
        )}
      </Pressable>
    </>
  )
}

import { ActivityIndicator, Pressable } from 'react-native'
import { ImagePlus, Mic } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'

type DictationState = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

type MobileTerminalInputActionsProps = {
  readonly canSend: boolean
  readonly isAttaching: boolean
  readonly dictation: DictationState
  readonly dictationMode: 'toggle' | 'hold'
  readonly onAttachImage: () => void
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
        // Tap opens the photo library; long-press picks a file. Uploads via host
        // RPC so SSH/remote sessions attach the same as local ones.
        onPress={onAttachImage}
        onLongPress={onAttachFile}
        delayLongPress={350}
        accessibilityLabel={isAttaching ? 'Sending image' : 'Attach a photo'}
        accessibilityHint="Long press to attach a file instead"
      >
        {isAttaching ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <ImagePlus size={18} color={colors.textSecondary} strokeWidth={2.2} />
        )}
      </Pressable>
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

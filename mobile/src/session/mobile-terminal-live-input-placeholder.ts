type DictationStatus = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

/** Placeholder for the visible live-input field. While dictation or an image
 *  attach is in flight the field is empty, so the placeholder doubles as the
 *  status line; otherwise it invites a tap to open the keyboard. */
export function getMobileTerminalLiveInputPlaceholder({
  dictation,
  isAttaching
}: {
  readonly dictation: DictationStatus
  readonly isAttaching: boolean
}): string {
  if (dictation.isRecording) {
    return 'Listening'
  }
  if (dictation.isProcessing) {
    return 'Transcribing'
  }
  if (dictation.isStarting) {
    return 'Starting mic'
  }
  if (isAttaching) {
    return 'Uploading image'
  }
  return 'Tap to type'
}

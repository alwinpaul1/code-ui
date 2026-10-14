import { useMemo } from 'react'
import { Copy, ExternalLink } from 'lucide-react-native'
import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { useClipboardWriter } from '../platform/clipboard'
import { triggerError, triggerSuccess } from '../platform/haptics'
import {
  FILE_LINK_MENU_LABELS,
  fileLinkMenuEntries,
  fileLinkNames
} from './mobile-native-chat-file-link'

/**
 * What a hold on an inline file link opens: the Claude app's menu for it
 * (mobile-native-chat-file-link.ts), as one of Code UI's sheets. The path as
 * written heads it; under it, Open, Copy file name and, when the path is
 * relative to the project, Copy relative path. Open waits for the sheet to
 * leave, since it can push the file's route and a route should not change
 * under a sheet still on screen.
 *
 * A copy buzzes success once the clipboard took the text and error when it
 * did not (the clipboard seam rejects), and says nothing else: the sheet is
 * gone by then, as the Claude app's menu is, and a haptic is the one answer
 * that needs no screen of its own.
 */
export function MobileNativeChatFileLinkSheet({
  visible,
  pathText,
  onOpen,
  onClose
}: {
  visible: boolean
  /** The path as the link wrote it, `:line` and all. */
  pathText: string
  onOpen: (pathText: string) => void
  onClose: () => void
}) {
  const clipboard = useClipboardWriter()
  const names = useMemo(() => fileLinkNames(pathText), [pathText])
  const copy = (text: string | null): void => {
    if (text === null) {
      return
    }
    clipboard.writeText(text).then(triggerSuccess, triggerError)
  }
  const actions: ActionSheetAction[] = []
  for (const entry of fileLinkMenuEntries(names)) {
    const label = FILE_LINK_MENU_LABELS[entry]
    switch (entry) {
      case 'open':
        actions.push({
          label,
          icon: ExternalLink,
          closeBeforePress: true,
          onPress: () => onOpen(pathText)
        })
        break
      case 'copy-file-name':
        actions.push({ label, icon: Copy, onPress: () => copy(names.fileName) })
        break
      case 'copy-relative-path':
        actions.push({ label, icon: Copy, onPress: () => copy(names.relativePath) })
        break
      default: {
        const unhandled: never = entry
        return unhandled
      }
    }
  }
  return (
    <ActionSheetModal
      visible={visible}
      title={pathText.trim()}
      actions={actions}
      onClose={onClose}
    />
  )
}

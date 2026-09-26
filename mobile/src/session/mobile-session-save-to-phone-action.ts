import { Download } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import {
  isSaveToPhoneSupported,
  saveDesktopFileToPhoneOnDevice
} from '../files/mobile-file-save-device'
import type { MobileFilePreviewRpcSender } from '../files/mobile-file-preview-operations'
import type { MobileSessionTab, Terminal } from './mobile-session-route-types'

type DocumentTab = Extract<MobileSessionTab, { type: 'file' | 'markdown' }>

const WAITING_NOTICE_MS = 1600

/**
 * "Save to Phone" in a file or Markdown tab's own long-press menu: the desktop's copy of the tab's
 * file, into the phone's storage through Android's "Save to" picker (mobile-file-save.ts). A
 * Markdown tab can hold unsaved phone edits, and the save does not carry them, so its row says
 * whose copy it is.
 *
 * A path outside the worktree reads through a grant that a terminal here vouches for, so the
 * connected terminals go along, the active one first, as the tab's own read does
 * (use-mobile-session-document-readers.ts).
 */
export function saveToPhoneSheetActions(
  /** The session controller, or the four members of it this reads. */
  session: {
    client: MobileFilePreviewRpcSender | null
    worktreeId: string
    terminals: readonly Terminal[]
    showToast: (message: string, durationMs?: number) => void
  },
  tab: DocumentTab | null,
  onDismiss: () => void
): ActionSheetAction[] {
  const { client, worktreeId, terminals, showToast: notify } = session
  if (!isSaveToPhoneSupported || !tab) {
    return []
  }
  return [
    {
      label: 'Save to Phone',
      icon: Download,
      ...(tab.type === 'markdown' ? { hint: 'The file as saved on the desktop' } : {}),
      onPress: () => {
        onDismiss()
        if (!client) {
          notify('Waiting for desktop…', WAITING_NOTICE_MS)
          return
        }
        const connected = terminals.filter((terminal) => terminal.connected !== false)
        void saveDesktopFileToPhoneOnDevice({
          client,
          source: {
            source: 'fileTab',
            worktreeId,
            path: tab.relativePath || tab.filePath,
            terminalHandles: [
              ...connected.filter((terminal) => terminal.isActive),
              ...connected.filter((terminal) => !terminal.isActive)
            ].map((terminal) => terminal.handle)
          },
          notify
        })
      }
    }
  ]
}

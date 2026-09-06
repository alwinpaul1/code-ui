import type { MobileChatPermission } from './mobile-native-chat-permission'
import { permissionOptionsFromScreen } from './mobile-terminal-permission-options'

/** Require a live selected Bash approval, not a quoted prompt in conversation history. */
export function claudePermissionFromScreen(lines: readonly string[]): MobileChatPermission | null {
  const start = lines.findLastIndex((line) => /^\s*Bash command\s*$/.test(line))
  if (start === -1) {
    return null
  }
  const dialog = lines.slice(start + 1)
  const menu = dialog.findIndex((line) => /^\s*[❯›>]\s*\d[.)]\s/.test(line))
  const first = dialog.findIndex((line) => /^\s*[❯›>]?\s*1[.)]\s+Yes\b/.test(line))
  const end = dialog.findIndex((line) => /Esc to cancel.*Tab to amend/i.test(line))
  if (
    menu === -1 ||
    first === -1 ||
    end < first ||
    !dialog.some((line) => /Do you want to proceed\?/.test(line))
  ) {
    return null
  }
  const options = permissionOptionsFromScreen(dialog.slice(first, end))
  if (!options) {
    return null
  }
  return { title: 'Allow Bash?', detail: dialog.slice(0, first).join('\n').trim(), options }
}

import type { MobileChatPermission } from './mobile-native-chat-permission'
import { parseTerminalDialogOptions } from './mobile-terminal-permission-options'

/** Read only a complete, currently selected Codex command-approval dialog.
 * The host hook can miss this overlay; its explicit shortcuts are authoritative. */
export function codexPermissionFromScreen(lines: readonly string[]): MobileChatPermission | null {
  const start = lines.findLastIndex((line) =>
    /^\s*Would you like to run the following command\?\s*$/.test(line)
  )
  if (start === -1) {
    return null
  }
  const dialog = lines.slice(start + 1)
  const firstOption = dialog.findIndex((line) => /^\s*[›❯>]?\s*1\.\s+Yes\b/.test(line))
  if (firstOption === -1 || !dialog.some((line) => /^\s*[›❯>]\s*\d\.\s+(Yes|No)\b/.test(line))) {
    return null
  }
  // Do not fold the footer into the last option when the screen has no blank line.
  const menu = dialog.slice(firstOption)
  const footer = menu.findIndex((line) => /Press enter to confirm/i.test(line))
  const rows = parseTerminalDialogOptions(footer === -1 ? menu : menu.slice(0, footer))
  const yes = rows.find((row) => /^Yes, proceed\s*\(y\)$/i.test(row.text))
  const no = rows.find((row) => /^No,.*\(esc\)$/i.test(row.text))
  if (!yes || !no) {
    return null
  }
  const persistent = rows.find((row) => /^Yes,.*don't ask again.*\(p\)$/i.test(row.text))
  const options: MobileChatPermission['options'] = [{ label: 'Allow once', send: 'y' }]
  if (persistent) {
    options.push({ label: persistent.text.replace(/\s*\(p\)$/i, ''), send: 'p' })
  }
  options.push({ label: 'Deny', send: '\x1b' })
  return {
    title: 'Run this command?',
    detail: dialog
      .slice(0, firstOption)
      .map((line) => line.trim())
      .join('\n')
      .trim(),
    options
  }
}

import { useEffect, useRef } from 'react'
import type { ClaudeAppCommand } from './ccr-slash-commands'

/**
 * Where the Claude app's own `/` commands open on the phone (ccr-slash-commands.ts). `/model` is
 * the chat controller's own sheet; `/workflows` (Background tasks) lives in the chat's tasks
 * provider and `/diff` (the changes) in the session screen, both in other subtrees. Each publishes
 * its opener here while it is mounted and takes it back on unmount, so a command opens only what
 * is there to open; with nothing published the command is sent as typed. The newest publisher of
 * a command owns it: an older one that unmounts late cannot clear a newer one.
 */
export type ClaudeAppSheetCommand = Exclude<ClaudeAppCommand, 'model'>

type Opener = { owner: object; open: () => void }

const openers = new Map<ClaudeAppSheetCommand, Opener>()

/** Opens the command's sheet; false when nothing is mounted to open it. */
export function openClaudeAppCommandSheet(command: ClaudeAppSheetCommand): boolean {
  const opener = openers.get(command)
  if (!opener) {
    return false
  }
  opener.open()
  return true
}

/** Publishes `open` for `command` while the caller is mounted (null publishes nothing). */
export function useClaudeAppCommandSheet(command: ClaudeAppSheetCommand, open: (() => void) | null): void {
  const owner = useRef<object>({})
  useEffect(() => {
    if (!open) {
      return
    }
    const me = owner.current
    openers.set(command, { owner: me, open })
    return () => {
      if (openers.get(command)?.owner === me) {
        openers.delete(command)
      }
    }
  }, [command, open])
}

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ClaudeAppCommand } from './ccr-slash-commands'

/**
 * Where the Claude app's own `/` commands open on the phone (ccr-slash-commands.ts). `/model` is
 * the chat controller's own sheet; `/workflows` (Background tasks) lives in the chat's tasks
 * provider and `/diff` (the changes) in the session screen, both in other subtrees. Each publishes
 * its opener here while it is mounted and takes it back on unmount, so a command opens only what
 * is there to open; with nothing published the command is sent as typed.
 *
 * Every live publisher of a command is kept, in mount order, and the most recently mounted one
 * opens. Each takes back only its own opener: with one entry per command, chat B mounting and
 * then unmounting deleted chat A's too, and A's typed /workflows went to Claude Code as text
 * while A was on screen (review 2026-10-15).
 */
export type ClaudeAppSheetCommand = Exclude<ClaudeAppCommand, 'model'>

/** Every command that opens a sheet published here (for tests that walk them all). */
export const CLAUDE_APP_SHEET_COMMANDS: readonly ClaudeAppSheetCommand[] = Object.freeze(['workflows', 'diff'] satisfies ClaudeAppSheetCommand[])

type Opener = { open: () => void }

/** Live openers per command, oldest first. */
const openers = new Map<ClaudeAppSheetCommand, Opener[]>()

/** Opens the command's sheet; false when nothing is mounted to open it. */
export function openClaudeAppCommandSheet(command: ClaudeAppSheetCommand): boolean {
  const opener = openers.get(command)?.at(-1)
  if (!opener) {
    return false
  }
  opener.open()
  return true
}

/** Publishes `open` for `command`; the returned function takes back this opener and no other. */
export function registerClaudeAppCommandSheet(command: ClaudeAppSheetCommand, open: () => void): () => void {
  const mine: Opener = { open }
  const list = openers.get(command) ?? []
  list.push(mine)
  openers.set(command, list)
  return () => {
    const live = openers.get(command)
    const at = live?.indexOf(mine) ?? -1
    if (live && at !== -1) {
      live.splice(at, 1)
      if (live.length === 0) {
        openers.delete(command)
      }
    }
  }
}

/** Publishes `open` for `command` while the caller is mounted (null publishes nothing). A new
 *  `open` on a later render is called in its place without re-publishing, so a re-render does
 *  not move an older chat ahead of a newer one. */
export function useClaudeAppCommandSheet(command: ClaudeAppSheetCommand, open: (() => void) | null): void {
  const latest = useRef(open)
  useLayoutEffect(() => {
    latest.current = open
  })
  const publishes = open !== null
  useEffect(() => (publishes ? registerClaudeAppCommandSheet(command, () => latest.current?.()) : undefined), [command, publishes])
}

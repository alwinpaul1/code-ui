import { expect, it } from 'vitest'
import {
  resolveObservedPermission,
  withTerminalDialogOptions
} from './mobile-terminal-permission-options-merge'
import type { MobileChatPermission } from './mobile-native-chat-permission'

const card = (title: string): MobileChatPermission => ({
  title,
  options: [
    { label: 'Yes', text: '1' },
    { label: 'No', text: '2' }
  ]
})

it('retires an answered Edit prompt instead of leaving its digits on screen', () => {
  // The dismissal was scoped to 'Allow Bash?', the one dialog the screen parser
  // recognises. Every other approval — Edit, Write, WebFetch, an MCP tool —
  // kept its card, with real digits scraped off the screen, for the whole tool
  // run. Answering one on the desktop and tapping the card afterwards wrote
  // that digit into whatever dialog had replaced it.
  expect(resolveObservedPermission(null, card('Allow Edit?'), true)).toBeNull()
  expect(resolveObservedPermission(null, card('Allow Bash?'), true)).toBeNull()
  expect(resolveObservedPermission(null, card('Allow WebFetch?'), true)).toBeNull()
})

it('keeps a card that has not been answered', () => {
  const reported = card('Allow Edit?')
  expect(resolveObservedPermission(null, reported, false)).toBe(reported)
})

it('prefers the dialog drawn on screen over the host summary', () => {
  const screen = card('Allow Bash?')
  expect(resolveObservedPermission(screen, card('Allow Edit?'), true)).toBe(screen)
})

it('puts the screen’s real options on a host-envelope card', () => {
  const reported = { title: 'Allow Edit?', options: [{ label: 'Allow', text: '1' }] }
  const drawn = [
    { label: 'Yes', text: '1' },
    { label: 'Yes, and don’t ask again', text: '2' },
    { label: 'No', text: '3' }
  ]
  expect(withTerminalDialogOptions(reported, drawn)).toEqual({ title: 'Allow Edit?', options: drawn })
  expect(withTerminalDialogOptions(reported, null)).toBe(reported)
})

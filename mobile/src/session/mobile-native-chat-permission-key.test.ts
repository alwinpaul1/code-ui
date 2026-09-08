import { expect, it } from 'vitest'
import {
  mobileChatPermissionKey,
  type MobileChatPermission
} from './mobile-native-chat-permission'

const prompt = (options: MobileChatPermission['options']): MobileChatPermission => ({
  title: 'Allow Bash?',
  command: 'rm -rf build',
  detail: 'Delete the build directory',
  options
})

it('keeps the card mounted while its options flicker mid-send', () => {
  // The card's in-flight guard is component-local and its remount key was the
  // whole permission object. The 1 Hz screen poll rewrites `options` whenever
  // the parse flips between the drawn dialog and the host envelope, so a card
  // remounted while the first keystroke was still crossing the relay: buttons
  // re-enabled, the "waiting for agent" state gone, and a second tap sent a
  // second key into the PTY.
  const envelope = prompt([
    { label: 'Allow', send: '1' },
    { label: 'Deny', send: '' }
  ])
  const drawn = prompt([
    { label: 'Yes', send: '1' },
    { label: 'Yes, and do not ask again', send: '2' },
    { label: 'No', send: '3' }
  ])
  expect(mobileChatPermissionKey(drawn)).toBe(mobileChatPermissionKey(envelope))
})

it('remounts for a different prompt so the previous answer never carries over', () => {
  const first = prompt([{ label: 'Allow', send: '1' }])
  expect(mobileChatPermissionKey({ ...first, command: 'rm -rf node_modules' })).not.toBe(
    mobileChatPermissionKey(first)
  )
  expect(mobileChatPermissionKey({ ...first, title: 'Allow Edit?' })).not.toBe(
    mobileChatPermissionKey(first)
  )
  expect(mobileChatPermissionKey({ ...first, detail: 'Delete everything' })).not.toBe(
    mobileChatPermissionKey(first)
  )
})

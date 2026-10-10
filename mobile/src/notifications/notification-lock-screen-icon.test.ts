// Symptom (S23 Ultra, One UI, 2026-10-10): a notification on a locked phone
// shows no Code UI icon on the lock screen / Always On Display, unlike
// WhatsApp. One UI needs a white-on-transparent small icon, a channel that is
// HIGH and not SECRET, and a service row that stays quiet.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { beforeEach, expect, it, vi } from 'vitest'

const created: { id: string; options: Record<string, unknown> }[] = []
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: vi.fn(async (id: string, options: Record<string, unknown>) => {
    created.push({ id, options })
  }),
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  dismissNotificationAsync: vi.fn(async () => {}),
  getAllScheduledNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android' } }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: async () => true }))
vi.mock('./notification-permissions', () => ({ ensureNotificationPermissions: async () => true }))

import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS,
  ensureNotificationChannel,
  resetNotificationChannelForTests
} from './local-notification-scheduling'

const MOBILE = fileURLToPath(new URL('../..', import.meta.url))
const read = (p: string) => readFileSync(`${MOBILE}/${p}`)

beforeEach(() => {
  created.length = 0
  resetNotificationChannelForTests()
})

it('configures expo-notifications with the monochrome icon and the brand colour', () => {
  const app = JSON.parse(read('app.json').toString()) as { expo?: { plugins: unknown[] }; plugins?: unknown[] }
  const plugins = (app.expo?.plugins ?? app.plugins) as unknown[]
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as [string, Record<string, string>]
  expect(entry[1].icon).toBe('./assets/notification-icon.png')
  expect(entry[1].color).toMatch(/^#[0-9a-fA-F]{6}$/)
})

it('ships a small icon that is white on transparent, so One UI can draw it on the lock screen and AOD', () => {
  const png = read('assets/notification-icon.png')
  let off = 8
  const idat: Buffer[] = []
  let width = 0
  let height = 0
  let colorType = 0
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    const type = png.toString('ascii', off + 4, off + 8)
    const data = png.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]!
    }
    if (type === 'IDAT') {
      idat.push(data)
    }
    off += 12 + len
  }
  expect(colorType).toBe(6)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  let prev = Buffer.alloc(stride)
  let opaque = 0
  let transparent = 0
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1)
    const filter = raw[base]!
    const row = Buffer.from(raw.subarray(base + 1, base + 1 + stride))
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? row[i - 4]! : 0
      const b = prev[i]!
      const c = i >= 4 ? prev[i - 4]! : 0
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      row[i] = (row[i]! + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth : 0)) & 255
    }
    for (let x = 0; x < width; x++) {
      const [r, g, bl, al] = [row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!, row[x * 4 + 3]!]
      if (al === 0) {
        transparent++
      } else {
        opaque++
        expect(Math.min(r, g, bl)).toBeGreaterThanOrEqual(240)
      }
    }
    prev = row
  }
  expect(opaque).toBeGreaterThan(0)
  expect(transparent).toBeGreaterThan(0)
})

it('posts agent notifications on a HIGH channel that shows on the lock screen and badges the app', async () => {
  await ensureNotificationChannel()
  const [channel] = created
  expect(channel!.options.importance).toBe(4)
  // PUBLIC = 1, PRIVATE = 2; SECRET (3) and UNKNOWN (0) hide the icon or defer.
  expect([1, 2]).toContain(channel!.options.lockscreenVisibility)
  expect(channel!.options.showBadge).toBe(true)
  expect(channel!.options.enableVibrate).toBe(false)
})

it('moves to a new channel id and retires the one whose lock-screen settings are frozen', () => {
  expect(ANDROID_NOTIFICATION_CHANNEL_ID).not.toBe('orca-desktop-quiet')
  expect(RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS).toContain('orca-desktop-quiet')
  expect(RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS).toContain('orca-desktop')
})

it('keeps the connected-service row LOW, silent and off the lock screen, drawn with the monochrome glyph', () => {
  const kt = read('packages/expo-background-link/android/src/main/java/expo/modules/backgroundlink/BackgroundLinkService.kt')
    .toString()
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
  expect(kt).toMatch(/NotificationManager\.IMPORTANCE_LOW/)
  expect(kt).toMatch(/PRIORITY_LOW/)
  expect(kt).toMatch(/VISIBILITY_SECRET/)
  expect(kt).toMatch(/getIdentifier\("notification_icon", "drawable"/)
  expect(kt).not.toMatch(/IMPORTANCE_(DEFAULT|HIGH)/)
})

it('posts every agent banner with HIGH priority for pre-Oreo heads-up', async () => {
  const notifications = await import('expo-notifications')
  const { showLocalNotification } = await import('./local-notification-scheduling')
  await showLocalNotification({ type: 'notification', source: 'agent-task-complete', title: 't', body: 'b' }, 'host')
  const call = vi.mocked(notifications.scheduleNotificationAsync).mock.calls.at(-1)![0] as { content: { priority?: string } }
  expect(call.content.priority).toBe('high')
})

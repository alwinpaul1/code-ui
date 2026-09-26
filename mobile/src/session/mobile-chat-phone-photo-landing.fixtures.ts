import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import { isDesktopImageRef } from './mobile-desktop-prompt-images'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import type { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

// The rows, photos and helpers of mobile-chat-phone-photo-landing.test.ts,
// kept here so the file of cases stays readable.

// Reported from the phone on 2026-09-26 (build 12e411e3), Claude Code 2.1.281,
// session 967668df. The records are the transcript's own, 1-based lines:
//   23621 user, promptSource "typed": "[Image #67] [Image #68] [Image #69] Now I
//         see 1 shell and 2 agents…" plus three base64 image blocks, which
//         Orca's reader drops (they have no path or url)
//   23624 user, isMeta, 1 ms later: three `[Image: source: …orca-paste-….png]`
//         text blocks, which Orca 1.4.211 keeps as their own user row
//   23679 / 23682 the same for "[Image #70] [Image #71] [Image #72] See images…"
// The bubble showed the photos, then three "Image on Desktop" chips over the
// same words, then the photos again after a flash. The second message was then
// drawn with the photos AND, under it, a bubble of three chips and no words.
export const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
export const at = (clock: string) => Date.parse(`2026-09-26T${clock}Z`)
export const TEXT1 = 'Now I see 1 shell and 2 agents\n\nAlso how did this prompt you are a second reviewer got leaked in'
export const TEXT2 =
  'See images were send from my phone, but at some point it glitching and showing its from my Images from Desktop then screen flashed and showd the images preview'
export const TEMP = '/var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T'
export const source = (file: string) => `[Image: source: ${TEMP}/${file}.png]`
export const PATHS1 = [
  'orca-paste-1790405916218-5211776c-2f4a-4164-bbdf-ed7c7adc9c20',
  'orca-paste-1790405982176-42c80aee-6038-4de8-aa23-68dca155febb',
  'orca-paste-1790405983769-e32af309-4eb4-4934-84cd-e16bc6599062'
]
export const PATHS2 = [
  'orca-paste-1790406096684-29b46d06-37a6-424d-9a46-11a4887e13da',
  'orca-paste-1790406098133-9fa460f0-2461-4934-a1ae-c31577111f35',
  'orca-paste-1790406099541-c7ab9697-2b10-4675-b08e-3ead2f0a7d98'
]
export const PHOTOS1 = ['file:///phone/a1.jpg', 'file:///phone/a2.jpg', 'file:///phone/a3.jpg']
export const PHOTOS2 = ['file:///phone/b1.jpg', 'file:///phone/b2.jpg', 'file:///phone/b3.jpg']

export const agentRow = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})
export const userRow = (id: string, texts: readonly string[], clock: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: texts.map((text) => ({ type: 'text' as const, text })),
  timestamp: at(clock),
  source: 'transcript'
})
/** Claude Code's prompt row for a paste: one `[Image #N]` per photo, then the words. */
export const markers = (first: number, count: number) =>
  Array.from({ length: count }, (_, index) => `[Image #${first + index}]`).join(' ')
export const promptRow = (id: string, first: number, count: number, body: string, clock: string) =>
  userRow(id, [body ? `${markers(first, count)} ${body}` : markers(first, count)], clock)
export const companionRow = (id: string, files: readonly string[], clock: string) => userRow(id, files.map(source), clock)

export const before = [agentRow('94b09904', 'One shell, two agents.', '06:58:36.593')]
export const P1 = promptRow('40b55aba', 67, 3, TEXT1, '07:00:19.716')
export const C1 = companionRow('c0153c78', PATHS1, '07:00:19.716')
export const reply1 = agentRow('cb327988', 'The reviewer prompt came from the spawn.', '07:02:23.131')
export const P2 = promptRow('e96491cb', 70, 3, TEXT2, '07:02:54.344')
export const C2 = companionRow('394fac0f', PATHS2, '07:02:54.345')

/** Orca's hook copy of a submission, as the tab status reports it: Claude's
 *  UserPromptSubmit prompt carries the `[Image #N]` markers. */
export function hookCopy(clock: string, body: string): DesktopPrompt[] {
  let state = EMPTY_AGENT_STATUS_PROMPTS
  state = observeAgentStatusPrompt(state, SESSION, { prompt: '', updatedAt: at(clock) })
  state = observeAgentStatusPrompt(state, SESSION, { prompt: body, updatedAt: at(clock) })
  return [...state.prompts]
}

/** Claude Code 2.1.281's queue block above its spinner (the layout pinned in
 *  mobile-terminal-queued-messages.test.ts), holding the given rows. */
export function claudeScreen(queued: readonly string[]): string[] {
  return [
    '● Running 1 shell command · 14s…',
    '',
    ...queued.map((row) => `❯ ${row}`),
    ...(queued.length ? ['  ctrl+x ctrl+s to send now'] : []),
    '',
    '✻ Incubating… (31m 27s · ↓ 67.8k tokens)',
    '',
    '────────────────────────────────────────────────────────────────────────────────',
    `❯ ${queued.length ? 'Press up to edit queued messages' : ''}`,
    '────────────────────────────────────────────────────────────────────────────────'
  ]
}

export type Tick = {
  /** The chat's transcript read has not settled: a kept transcript, or none. */
  loading?: boolean
  messages: NativeChatMessage[]
  working?: boolean
  prompts?: DesktopPrompt[]
  queued?: string[]
  screen?: string[]
  agent?: 'claude' | 'codex'
}
export type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
/** A user bubble as the list draws it: `P` a picture, `D` the "Image on
 *  Desktop" chip, then the words. */
export type Bubble = { id: string; images: string; text: string }

export function bubblesIn(props: Record<string, unknown>): Bubble[] {
  const { data } = buildMobileNativeChatTransientData({
    messages: props.messages as NativeChatMessage[],
    folded: props.folded as NativeChatMessage[],
    streaming: null,
    pending: props.pending as never,
    imagePreviewsByMessageId: props.imagePreviewsByMessageId as Record<string, string[]>
  })
  return data
    .filter((message) => message.role === 'user')
    .map((message) => ({
      id: message.id,
      images: message.blocks
        .map((block) => (block.type !== 'image-ref' ? '' : isDesktopImageRef(block) ? 'D' : 'P'))
        .join(''),
      text: message.blocks
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    }))
}
export const words = (text: string) => text.replace(/\s+/g, ' ').trim()

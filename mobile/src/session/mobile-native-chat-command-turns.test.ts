import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'

// Rows of a hand-started Claude Code 2.1.278 session
// (~/.claude/projects/…/a10fe5ce…jsonl, 2026-09-19), as Orca's reader
// publishes them. A `/loop` scheduled wake-up is a `user` row whose content is
// the command envelope, `turnOrigin: "scheduled"`; the one typed at 21:24 has
// the same envelope with `turnOrigin: "human"`.
const LOOP_ENVELOPE =
  '<command-message>loop</command-message>\n<command-name>/loop</command-name>\n<command-args>and check job 2888</command-args>'

function text(
  id: string,
  role: 'user' | 'assistant' | 'system',
  body: string,
  timestamp: number
): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text: body }], timestamp, source: 'transcript' }
}

const T = (clock: string) => Date.parse(`2026-09-19T${clock}Z`)

const rows: NativeChatMessage[] = [
  text('u-see', 'user', 'See our app had no reply while claude had the reply', T('21:26:27.000')),
  {
    id: 'a-bash',
    role: 'assistant',
    blocks: [{ type: 'tool-call', id: 'call-1', name: 'Bash', input: { command: 'ls' } }],
    timestamp: T('21:26:55.000'),
    source: 'transcript'
  },
  {
    id: 'u-bash',
    role: 'tool',
    blocks: [{ type: 'tool-result', toolCallId: 'call-1', output: 'ok' }],
    timestamp: T('21:26:57.000'),
    source: 'transcript'
  },
  text('a-reply', 'assistant', 'On the two screens: the reply did reach both.', T('21:27:06.000')),
  text('e1ff0954-b5e4-498c-91ee-5511820fbe9a', 'user', LOOP_ENVELOPE, T('21:41:00.279')),
  {
    id: 'a-bash-2',
    role: 'assistant',
    blocks: [{ type: 'tool-call', id: 'call-2', name: 'Bash', input: { command: 'squeue' } }],
    timestamp: T('21:41:13.000'),
    source: 'transcript'
  },
  {
    id: 'u-bash-2',
    role: 'tool',
    blocks: [{ type: 'tool-result', toolCallId: 'call-2', output: 'waiting' }],
    timestamp: T('21:41:16.000'),
    source: 'transcript'
  },
  text('a-reply-2', 'assistant', 'Job 2888 is still waiting.', T('21:41:22.000'))
]

const bubbleTexts = (folded: readonly NativeChatMessage[]) =>
  folded.map(
    (message) =>
      `${message.role}:${message.blocks.map((block) => (block.type === 'text' ? block.text : `[${block.type}]`)).join('')}`
  )

// 2026-09-19, on the phone: the `/loop and check job 2888` bubble was drawn
// ABOVE the reply it came fourteen minutes after, between "Ran a command" and
// "On the two screens…". The envelope row was stripped as harness noise, so the
// only thing drawing the turn was the hook-fed echo, anchored by a status clock
// that is not the prompt's time. The Claude app draws the turn from the
// transcript, in order. So does the phone now: the envelope IS the user's turn.
describe('a slash-command turn in the transcript', () => {
  it('draws a scheduled /loop turn where the transcript has it, after the reply before it', () => {
    const folded = foldMobileNativeChatMessages(rows)
    const texts = bubbleTexts(folded)
    const loop = texts.indexOf('user:/loop and check job 2888')
    expect(loop).toBeGreaterThan(texts.indexOf('assistant:On the two screens: the reply did reach both.'))
    expect(loop).toBeLessThan(texts.indexOf('assistant:Job 2888 is still waiting.'))
  })

  it('retires the hook-fed echo of that prompt, so the turn shows once', () => {
    const folded = foldMobileNativeChatMessages(rows)
    const status = [
      { nonce: 'status:a10fe5ce:1789853760279:2', text: '/loop and check job 2888', at: T('21:41:00.279') }
    ]
    expect(withoutLandedDesktopPrompts(status, folded)).toEqual([])
  })

  it('breaks the tool fold at the turn, as the Claude app does ("Ran Check job 2888 now" after "/loop")', () => {
    const folded = foldMobileNativeChatMessages(rows)
    const texts = bubbleTexts(folded)
    const loop = texts.indexOf('user:/loop and check job 2888')
    // The tool call that answered the /loop is folded AFTER it, not glued to
    // the previous turn's fold.
    expect(texts[loop + 1]).toMatch(/^assistant:\[tool-/)
  })

  it('never draws a bare envelope: a /reload-plugins mid-turn looks like a skill the agent answered', () => {
    // /reload-plugins and /clear write their output as a `system` row the
    // reader drops (b4c9b022…jsonl 16:46:24 and five more), so on the phone
    // the row after a bare local command issued mid-turn is the agent's next
    // tool call. A bare skill (`/poteto-mode`) is shown by the hook echo.
    const midTurn = foldMobileNativeChatMessages([
      text('a0', 'assistant', 'hi', 1),
      text('u0', 'user', '<command-name>/reload-plugins</command-name>\n            <command-message>reload-plugins</command-message>\n            <command-args></command-args>', 2),
      {
        id: 'a1',
        role: 'assistant',
        blocks: [{ type: 'tool-call', id: 'c1', name: 'Bash', input: { command: 'ls' } }],
        timestamp: 3,
        source: 'transcript'
      },
      text('a2', 'assistant', 'Done.', 4)
    ])
    expect(bubbleTexts(midTurn).filter((row) => row.startsWith('user:'))).toEqual([])
    const compact = foldMobileNativeChatMessages([
      text('a0', 'assistant', 'hi', 1),
      text('u0', 'user', '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>', 2)
    ])
    expect(bubbleTexts(compact)).toEqual(['assistant:hi'])
  })

  it('still hides local-command output and the other harness rows', () => {
    const folded = foldMobileNativeChatMessages([
      text('a0', 'assistant', 'hi', 1),
      text('u1', 'user', '<local-command-stdout>plugins reloaded</local-command-stdout>', 2),
      text('u2', 'user', '<system-reminder>reminder</system-reminder>', 3)
    ])
    expect(bubbleTexts(folded)).toEqual(['assistant:hi'])
  })
})

// Review of the change above (2026-09-19): the surfaced turn shortens a
// plugin-qualified skill to the token the user sent (`/codex:rescue` → `/rescue`,
// upstream's rule), but the hook echo carries the prompt as typed, so a
// `/plugin:name …` typed in full on the desktop drew twice.
it('retires the hook echo of a plugin-qualified skill typed in full', () => {
  const folded = foldMobileNativeChatMessages([
    text('a0', 'assistant', 'hi', T('21:00:00.000')),
    text(
      'u0',
      'user',
      '<command-message>rescue</command-message>\n<command-name>/codex:rescue</command-name>\n<command-args>look at the failing build</command-args>',
      T('21:00:05.000')
    )
  ])
  expect(bubbleTexts(folded)).toEqual(['assistant:hi', 'user:/rescue look at the failing build'])
  const status = [{ nonce: 's', text: '/codex:rescue look at the failing build', at: T('21:00:05.000') }]
  expect(withoutLandedDesktopPrompts(status, folded)).toEqual([])
})

// Review (2026-09-19): upstream surfaces an envelope only when every block is
// text, so a `/x` sent with a photo stayed hidden as noise and the photo
// vanished with it. The turn is the user's whether or not it carries an image.
it('surfaces a slash command sent with a photo, photo kept', () => {
  const folded = foldMobileNativeChatMessages([
    text('a0', 'assistant', 'hi', T('21:00:00.000')),
    {
      id: 'u0',
      role: 'user',
      blocks: [
        {
          type: 'text',
          text: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>this screen</command-args>'
        },
        { type: 'image-ref', url: 'file:///tmp/shot.jpg' }
      ],
      timestamp: T('21:00:05.000'),
      source: 'transcript'
    }
  ])
  expect(bubbleTexts(folded)).toEqual(['assistant:hi', 'user:/review this screen[image-ref]'])
})

// 2026-09-20, phone screenshot on 0.9.4: switching model and effort from the
// phone's picker left "/model fable", "/model opus", "/effort xhigh" bubbles
// in the chat. Claude Code answers those itself, no model turn: the rows, as
// Orca's reader publishes them (the `<local-command-caveat>` isMeta row before
// each is dropped by the reader):
//   user 06:32:31 <command-name>/model</command-name> … <command-args>fable</command-args>
//   user 06:32:31 <local-command-stdout>Set model to `Fable 5.1` and saved as your default for new sessions</local-command-stdout>
// A `/loop` wake-up has no such row after it; the agent's own tool call does.
// The output row is the transcript saying "the CLI handled this": such an
// envelope is not a turn and stays hidden with its output.
describe('a command the CLI answered itself', () => {
  const ENVELOPE = (name: string, args: string) =>
    `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`
  const rows: NativeChatMessage[] = [
    text('a0', 'assistant', 'Left as is.', T('06:30:00.000')),
    text('u1', 'user', ENVELOPE('model', 'fable'), T('06:32:31.023')),
    text(
      'u1o',
      'user',
      '<local-command-stdout>Set model to `Fable 5.1` and saved as your default for new sessions</local-command-stdout>',
      T('06:32:31.023')
    ),
    text('u2', 'user', ENVELOPE('model', 'opus'), T('06:36:23.712')),
    text(
      'u2o',
      'user',
      '<local-command-stdout>Set model to `Opus 5` and saved as your default for new sessions</local-command-stdout>',
      T('06:36:23.712')
    ),
    text('u3', 'user', ENVELOPE('effort', 'xhigh'), T('06:36:27.955')),
    text(
      'u3o',
      'user',
      '<local-command-stdout>Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning than high, just below maximum (Fable 5, Opus 4.7+, Sonnet 5)</local-command-stdout>',
      T('06:36:27.955')
    ),
    text('u4', 'user', "[Image #13] I didn't find this file on file search", T('06:36:57.798'))
  ]

  it('is not drawn when switching model or effort', () => {
    expect(bubbleTexts(foldMobileNativeChatMessages(rows))).toEqual([
      'assistant:Left as is.',
      // The `[Image #13]` marker is the "Image on Desktop" chip.
      "user:[image-ref]I didn't find this file on file search"
    ])
  })

  it('still draws a command the agent answered, such as the /loop wake-up', () => {
    const loop = foldMobileNativeChatMessages([
      text('a0', 'assistant', 'On the two screens.', T('21:27:06.000')),
      text('u0', 'user', LOOP_ENVELOPE, T('21:41:00.279')),
      {
        id: 'a1',
        role: 'assistant',
        blocks: [{ type: 'tool-call', id: 'c1', name: 'Bash', input: { command: 'squeue' } }],
        timestamp: T('21:41:13.000'),
        source: 'transcript'
      }
    ])
    expect(bubbleTexts(loop)[1]).toBe('user:/loop and check job 2888')
  })

  it('hides a /clear, whose output row the reader does not publish', () => {
    // a10fe5ce…jsonl 12:49:48: the envelope, then a `system` row (subtype
    // local_command) `<local-command-stdout></local-command-stdout>`. Orca's
    // reader drops that row (nativeChat.readSession, checked 2026-09-20), so
    // the published row after the envelope is the user's next prompt. Bare,
    // so hidden either way; the system-row case is pinned too in case a
    // reader ever publishes it.
    const published = foldMobileNativeChatMessages([
      text('u0', 'user', ENVELOPE('clear', ''), T('12:49:48.975')),
      text('u1', 'user', 'I had a meeting with mahdi', T('12:55:24.031'))
    ])
    expect(bubbleTexts(published)).toEqual(['user:I had a meeting with mahdi'])
    const withSystemRow = foldMobileNativeChatMessages([
      text('u0', 'user', ENVELOPE('clear', ''), T('12:49:48.975')),
      text('s0', 'system', '<local-command-stdout></local-command-stdout>', T('12:49:49.118')),
      text('u1', 'user', 'I had a meeting with mahdi', T('12:55:24.031'))
    ])
    expect(bubbleTexts(withSystemRow)).toEqual(['user:I had a meeting with mahdi'])
  })

  it('hides a bare /model that opened the picker and wrote nothing', () => {
    // The desktop TUI's own `/model` (no args) opens a picker; no output row
    // follows. A bubble reading "/model" tells the reader nothing.
    // f9eb3513…jsonl 09:57:39 and 09:57:42: two bare `/model` rows, then the
    // user's next typed prompt. Nothing of the agent's stands between.
    const folded = foldMobileNativeChatMessages([
      text('a0', 'assistant', 'hi', T('09:57:00.000')),
      text('u0', 'user', ENVELOPE('model', ''), T('09:57:39.077')),
      text('u1', 'user', ENVELOPE('model', ''), T('09:57:42.896')),
      text('u2', 'user', 'now continue', T('09:58:00.000'))
    ])
    expect(bubbleTexts(folded)).toEqual(['assistant:hi', 'user:now continue'])
  })
})

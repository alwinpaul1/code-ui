import { describe, expect, it } from 'vitest'
import { parseCcrEvent } from './ccr-session-api'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { LOCAL_COMMAND_PRESENTATION } from './mobile-native-chat-local-command'
import {
  FORKED_SKILL_DRAWN_TEXT,
  FORKED_SKILL_LOCAL_COMMAND_RECORD,
  FORKED_SKILL_LOCAL_COMMAND_SOURCE,
  FORKED_SKILL_LOCAL_COMMAND_UUID,
  FORKED_SKILL_TWIN_TEXT,
  forkedSkillTwinEvent
} from './fixtures/ccr-local-command-forked-skill-2026-10-15'

// A slash command's own output (here `/code-review … --fix` starting the skill as a background
// agent, Claude Code 2.1.300) reaches Remote Control as an `assistant` event carrying
// `local_command_source` (fixtures/ccr-local-command-forked-skill-2026-10-15.ts). The Claude app
// 1.261009.20 marks its text as command output (alt.g, alt.java:59-69, into the text part's flag
// via rhu.k, rhu.java:1639-1657) and draws it with a rule down its left side in the dimmed ink
// (mw20.java:181-193, vb20.j vb20.java:1733-1736). Ours drew it as Claude's own reply, the
// `<forked-skill-launch>` tags printed as text.

function rows(...raws: Record<string, unknown>[]) {
  return decodeCcrEvents(raws.map((raw) => parseCcrEvent(raw)!), new WeakMap())
}

/** Claude Code 2.1.300's conversion of a `local_command` record for an SDK client (`Uqt`). */
function unwrapLikeClaudeCode(content: string): string {
  return content.replace(/<(local-command-stdout|local-command-stderr)>([\s\S]*?)<\/\1>/g, '$2').trim()
}

describe('a slash command’s output on an Anthropic-drawn Claude tab', () => {
  it('the fixture’s message text is Claude Code’s own unwrapping of the recorded output', () => {
    expect(JSON.parse(FORKED_SKILL_LOCAL_COMMAND_RECORD).subtype).toBe('local_command')
    expect(unwrapLikeClaudeCode(FORKED_SKILL_LOCAL_COMMAND_SOURCE)).toBe(FORKED_SKILL_TWIN_TEXT)
  })

  it('a background skill launch is a command-output row, not Claude’s reply with its tags printed', () => {
    expect(rows(forkedSkillTwinEvent())).toEqual([
      {
        id: FORKED_SKILL_LOCAL_COMMAND_UUID,
        role: 'assistant',
        blocks: [{ type: 'text', text: FORKED_SKILL_DRAWN_TEXT, presentation: LOCAL_COMMAND_PRESENTATION }],
        timestamp: Date.parse('2026-10-15T13:20:36.125Z'),
        source: 'transcript'
      }
    ])
  })

  it('a command that printed an error stays ordinary text, as the app leaves stderr unmarked', () => {
    const source = '<local-command-stderr>Unknown skill: nope</local-command-stderr>'
    const decoded = rows(
      forkedSkillTwinEvent({
        local_command_source: source,
        message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'Unknown skill: nope' }] }
      })
    )
    expect(decoded.map((row) => [row.role, row.blocks])).toEqual([['assistant', [{ type: 'text', text: 'Unknown skill: nope' }]]])
  })

  it('a real model reply, an error or an API error message is never drawn as command output', () => {
    const real = rows(
      forkedSkillTwinEvent({ message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done.' }] } })
    )
    const failed = rows(forkedSkillTwinEvent({ error: 'unknown' }))
    const apiError = rows(forkedSkillTwinEvent({ isApiErrorMessage: true }))
    for (const decoded of [real, failed, apiError]) {
      expect(decoded[0]!.blocks.every((block) => block.type !== 'text' || block.presentation === undefined)).toBe(true)
    }
  })

  it('a lone placeholder in angle brackets is kept: only a tag with its closing tag is unwrapped', () => {
    const text = 'Usage: /model <name>\n<model-switch>Set to Opus</model-switch>'
    const decoded = rows(forkedSkillTwinEvent({ message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] } }))
    expect(decoded[0]!.blocks).toEqual([{ type: 'text', text: 'Usage: /model <name>\nSet to Opus', presentation: LOCAL_COMMAND_PRESENTATION }])
  })

  it('output that is only empty tags draws no row rather than an empty rule', () => {
    const text = '<forked-skill-launch></forked-skill-launch>'
    expect(rows(forkedSkillTwinEvent({ message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] } }))).toEqual([])
  })

  it('the raw `local_command` record, should it ever arrive as a system event, still draws nothing', () => {
    const record = JSON.parse(FORKED_SKILL_LOCAL_COMMAND_RECORD) as Record<string, unknown>
    expect(rows({ created_at: '2026-10-15T13:20:36.125Z', event_id: 'evt_raw', payload: record, sequence_num: '411' })).toEqual([])
  })
})

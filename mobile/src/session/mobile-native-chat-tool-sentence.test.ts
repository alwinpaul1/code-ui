import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { SEND_MESSAGE_PREVIEW_MAX, toolCallKind, toolRunSentence } from './mobile-native-chat-tool-sentence'
import { CREATED_A_FILE_RUN, EDITED_A_FILE_RUN } from './fixtures/claude-edit-runs-2.1.282'
import { SEND_MESSAGE_BY_ID_2026_09_26 } from './fixtures/claude-send-message-2026-09-26'

function call(name: string): NativeChatBlock {
  return { type: 'tool-call', id: `c-${name}-${Math.random()}`, name, input: {} }
}
function result(isError = false): NativeChatBlock {
  return { type: 'tool-result', toolCallId: 'x', output: '', ...(isError ? { isError: true } : {}) }
}

// The Claude app's fold rows, 2026-09-12 screenshots: "Ran 3 commands ›",
// "Ran a command, read a file ›", "Ran 12 commands (2 failed), read 6 files ›".
describe('toolRunSentence', () => {
  it('reads like the Claude app for the common shapes', () => {
    expect(
      toolRunSentence([call('Bash'), result(), call('Bash'), result(), call('Bash'), result()])
    ).toBe('Ran 3 commands')
    expect(toolRunSentence([call('Bash'), result(), call('Read'), result()])).toBe(
      'Ran a command, read a file'
    )
  })

  it('names the one file a read opened, in the order the calls happened', () => {
    const read = (path: string): NativeChatBlock => ({
      type: 'tool-call',
      id: 'read-blade',
      name: 'Read',
      input: { file_path: path }
    })
    expect(
      toolRunSentence([
        read('/repo/figures/blade_flow_check.png'),
        result(),
        call('Bash'),
        result()
      ])
    ).toBe('Read blade_flow_check.png, ran a command')
  })

  it('counts failures against the kind that failed', () => {
    const blocks: NativeChatBlock[] = []
    for (let i = 0; i < 12; i += 1) {
      blocks.push(call('Bash'), result(i < 2))
    }
    for (let i = 0; i < 6; i += 1) {
      blocks.push(call('Read'), result())
    }
    expect(toolRunSentence(blocks)).toBe('Ran 12 commands (2 failed), read 6 files')
  })

  it('groups by what the tool did, across agents', () => {
    expect(toolCallKind('shell')).toBe('command')
    expect(toolCallKind('Bash')).toBe('command')
    expect(toolCallKind('MultiEdit')).toBe('edit')
    expect(toolCallKind('Grep')).toBe('search')
    expect(toolCallKind('Agent')).toBe('agent')
    expect(toolCallKind('WebFetch')).toBe('web')
    expect(toolCallKind('browser.open')).toBe('other')
    expect(
      toolRunSentence([call('Edit'), result(), call('Grep'), result(), call('Grep'), result()])
    ).toBe('Edited a file, searched 2 times')
  })

  it('is empty for a run with no calls', () => {
    expect(toolRunSentence([])).toBe('')
  })

  // docs/claude-app-parity.md item 2. Real `Bash` calls (~/.claude/projects
  // transcripts) carry a `description` field alongside `command`; a single
  // labelled command reads by that description, the way the Claude app's
  // "Ran Count K*_F changes in section3 accountings" row does.
  it('names a single command by its own description', () => {
    const bash: NativeChatBlock = {
      type: 'tool-call',
      id: 'c-bash-1',
      name: 'Bash',
      input: { command: 'ping -c 200 127.0.0.1', description: 'Ping localhost 200 times' }
    }
    expect(toolRunSentence([bash, result()])).toBe('Ran Ping localhost 200 times')
  })

  it('still says "a command" when the one command has no description', () => {
    expect(toolRunSentence([call('Bash'), result()])).toBe('Ran a command')
  })

  // The 2026-09-26 screenshot: each run held one described Bash call beside a
  // Write or an Edit, and the Claude app named neither command by its
  // description (fixtures/claude-edit-runs-2.1.282.ts).
  it('says "ran a command" beside an edit, as the Claude app does, even for a described command', () => {
    expect(toolRunSentence(CREATED_A_FILE_RUN)).toBe('Created a file, ran a command')
    expect(toolRunSentence(EDITED_A_FILE_RUN)).toBe('Edited a file, ran a command')
  })

  it('drops the description once a second command joins the run', () => {
    const bash = (description: string): NativeChatBlock => ({
      type: 'tool-call',
      id: `c-bash-${description}`,
      name: 'Bash',
      input: { command: 'x', description }
    })
    expect(
      toolRunSentence([bash('Ping localhost'), result(), bash('Curl the endpoint'), result()])
    ).toBe('Ran 2 commands')
  })

  // The Skill tool's own input carries `skill` (a name), never a description,
  // and the Claude app's row for it says only "Ran skill" — no article, no
  // skill name.
  it('reads the Skill tool as "Ran skill"', () => {
    expect(toolCallKind('Skill')).toBe('skill')
    const skill: NativeChatBlock = {
      type: 'tool-call',
      id: 'c-skill-1',
      name: 'Skill',
      input: { skill: 'unslop' }
    }
    expect(toolRunSentence([skill, result()])).toBe('Ran skill')
  })

  // SendMessage's own input carries `to` and `summary` (verified against real
  // `SendMessage` tool_use records); the Claude app draws the whole row from
  // those two fields, never "Ran a tool".
  it('reads a SendMessage call as "Messaged @<to> <summary>"', () => {
    expect(toolCallKind('SendMessage')).toBe('message')
    const send: NativeChatBlock = {
      type: 'tool-call',
      id: 'c-send-1',
      name: 'SendMessage',
      input: {
        to: 'a8f65c53ecfad2908',
        summary: 'Re-check the post-review fix',
        message: 'Full message body, not shown in the row',
        type: 'message',
        recipient: 'a8f65c53ecfad2908'
      }
    }
    expect(toolRunSentence([send, result()])).toBe(
      'Messaged @a8f65c53ecfad2908 Re-check the post-review fix'
    )
  })

  it('falls back to the generic noun when a SendMessage names no recipient', () => {
    const send: NativeChatBlock = {
      type: 'tool-call',
      id: 'c-send-2',
      name: 'SendMessage',
      input: {}
    }
    expect(toolRunSentence([send, result()])).toBe('Messaged an agent')
  })

  // 2026-09-26: the Claude app drew "Messaged @a07ea6f616a8e32a1 Agreed. Your
  // measurem… ›" for a SendMessage with no `summary`, where the phone said
  // "Messaged an agent".
  describe('a SendMessage with no summary (2026-09-26 screenshots)', () => {
    const blocks = (input: Record<string, unknown>): NativeChatBlock[] => [
      { type: 'tool-call', id: 'c-send-3', name: 'SendMessage', input },
      result()
    ]
    const real = SEND_MESSAGE_BY_ID_2026_09_26.call!.input as Record<string, unknown>

    it('names the recipient and previews the message on the row', () => {
      const sentence = toolRunSentence(blocks(real))
      expect(sentence.startsWith('Messaged @a07ea6f616a8e32a1 Agreed. Your measurement beats my read of the frames.')).toBe(true)
      // Cut before native layout; the row's own one-line ellipsis does the rest.
      expect(sentence.endsWith('…')).toBe(true)
      expect(sentence.length).toBeLessThan((real.message as string).length)
    })

    it('shows a named recipient as its name', () => {
      expect(toolRunSentence(blocks({ to: 'researcher', message: 'Look at the parser.' }))).toBe(
        'Messaged @researcher Look at the parser.'
      )
    })

    it('reads the recipient from `recipient` when there is no `to`', () => {
      expect(toolRunSentence(blocks({ recipient: 'reviewer', message: 'Done.' }))).toBe(
        'Messaged @reviewer Done.'
      )
    })

    it('previews `content` when there is no `message`', () => {
      expect(toolRunSentence(blocks({ to: 'reviewer', content: 'Short note' }))).toBe(
        'Messaged @reviewer Short note'
      )
    })

    it('keeps a multi-line message on one line', () => {
      expect(toolRunSentence(blocks({ to: 'reviewer', message: 'First line\n\n  second line\t end' }))).toBe(
        'Messaged @reviewer First line second line end'
      )
    })

    it('names the recipient alone when the message is empty or blank', () => {
      expect(toolRunSentence(blocks({ to: 'reviewer', message: '' }))).toBe('Messaged @reviewer')
      expect(toolRunSentence(blocks({ to: 'reviewer', message: ' \n ' }))).toBe('Messaged @reviewer')
      expect(toolRunSentence(blocks({ to: 'reviewer' }))).toBe('Messaged @reviewer')
    })

    it('keeps a message of exactly the preview cap whole, and cuts one character more', () => {
      const exact = 'x'.repeat(SEND_MESSAGE_PREVIEW_MAX)
      expect(toolRunSentence(blocks({ to: 'r', message: exact }))).toBe(`Messaged @r ${exact}`)
      expect(toolRunSentence(blocks({ to: 'r', message: `${exact}y` }))).toBe(`Messaged @r ${exact}…`)
    })

    it('says "Messaged an agent" when there is no recipient, whatever the message', () => {
      expect(toolRunSentence(blocks({ message: 'Hello' }))).toBe('Messaged an agent')
      expect(toolRunSentence(blocks({ to: '  ', message: 'Hello' }))).toBe('Messaged an agent')
    })
  })

  // A whole-content Write reads identically whether it created the file or
  // overwrote one; only the result's own "File created successfully" text (or
  // an explicit `command: "create"`) is certain evidence of a creation — the
  // same rule the inline diff card already applies (native-chat-edit-normalize).
  it('reads a Write the result is certain created a new file as "created a file"', () => {
    const write: NativeChatBlock = {
      type: 'tool-call',
      id: 'c-write-1',
      name: 'Write',
      input: { file_path: '/repo/NEW.md', content: 'line one\nline two\n' }
    }
    const created: NativeChatBlock = {
      type: 'tool-result',
      toolCallId: 'x',
      output: 'File created successfully at: /repo/NEW.md'
    }
    expect(toolRunSentence([write, created])).toBe('Created a file')
  })

  it('reads an ordinary overwrite as "edited a file", never a guessed creation', () => {
    const write: NativeChatBlock = {
      type: 'tool-call',
      id: 'c-write-2',
      name: 'Write',
      input: { file_path: '/repo/existing.md', content: 'updated\n' }
    }
    const overwritten: NativeChatBlock = { type: 'tool-result', toolCallId: 'x', output: 'ok' }
    expect(toolRunSentence([write, overwritten])).toBe('Edited a file')
  })

  // The exact shape from the Claude app screenshot: two plain commands and one
  // brand-new file in the same run.
  it('reads "Ran 2 commands, created a file" for the screenshot\'s shape', () => {
    const write: NativeChatBlock = {
      type: 'tool-call',
      id: 'c-write-3',
      name: 'Write',
      input: { file_path: '/repo/NEW.md', content: 'a\nb\n' }
    }
    const created: NativeChatBlock = {
      type: 'tool-result',
      toolCallId: 'x',
      output: 'File created successfully at: /repo/NEW.md'
    }
    expect(toolRunSentence([call('Bash'), result(), call('Bash'), result(), write, created])).toBe(
      'Ran 2 commands, created a file'
    )
  })
})

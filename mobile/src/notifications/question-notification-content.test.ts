import { describe, expect, it } from 'vitest'
import { parseAskFromStatus, type AskPrompt } from '../../../src/shared/native-chat-ask'
import {
  ASK_USER_QUESTION_CLEANUP,
  ASK_USER_QUESTION_CONTEXT_RING,
  ASK_USER_QUESTION_STACK_AND_LOOK,
  ASK_USER_QUESTION_WHICH_LOGO,
  CODEX_REQUEST_USER_INPUT
} from './ask-user-question-fixtures'
import { styleText } from './notification-plain-text'
import {
  QUESTION_ANSWER_ACTION,
  questionNotificationContent
} from './question-notification-content'

function prompt(input: unknown): AskPrompt {
  const parsed = parseAskFromStatus(JSON.stringify(input))
  if (!parsed) {
    throw new Error('fixture did not parse')
  }
  return parsed
}

const AT = { agent: 'claude', location: 'NexOS / main' }

/**
 * "❓ Claude needs input · NexOS / main — Using AskUserQuestion" was the whole
 * banner (Galaxy S23, 2026-09-18): the tool's name, not the question, and no
 * way to answer short of unlocking, opening the app and finding the session.
 * The question is on the host, verbatim, and is what the shade should say.
 */
describe('turning a question into what the shade shows', () => {
  it('leads with the header, then says the question and numbers the choices', () => {
    const content = questionNotificationContent(prompt(ASK_USER_QUESTION_CONTEXT_RING), AT)
    expect(content.title).toBe('Context ring · NexOS / main')
    expect(content.body).toBe(
      'Codex only reports context via /status, not continuously. How should the context indicator work?\n' +
        '1 Tap to refresh · 2 Skip it for Codex'
    )
  })

  it('offers one button per choice, in order, each knowing which option it picks', () => {
    const content = questionNotificationContent(prompt(ASK_USER_QUESTION_CONTEXT_RING), AT)
    expect(content.actions).toEqual([
      { identifier: 'question:0', label: 'Tap to refresh', pick: 0 },
      { identifier: 'question:1', label: 'Skip it for Codex', pick: 1 }
    ])
  })

  // Claude's TUI draws an "Other" free-text row under every question. It is
  // the selector's own, not an option, and the shade has no text field: three
  // options are three buttons, never four.
  it('does not invent a button for the free-text row', () => {
    const content = questionNotificationContent(prompt(ASK_USER_QUESTION_WHICH_LOGO), AT)
    expect(content.actions).toHaveLength(3)
    expect(content.actions.map((a) => a.label)).not.toContain('Other')
  })

  // Android clips a long action title without an ellipsis, so the cut is made
  // here, where it can say it was cut. Real labels run to 40 characters.
  it('shortens a long label to about twenty characters with an ellipsis', () => {
    const content = questionNotificationContent(prompt(ASK_USER_QUESTION_WHICH_LOGO), AT)
    expect(content.actions.map((a) => a.label)).toEqual([
      'The app icon',
      'The agent session c…',
      'The notification ic…'
    ])
    for (const action of content.actions) {
      expect(action.label.length).toBeLessThanOrEqual(20)
    }
  })

  it('shortens a sixty-character label the same way', () => {
    const sixty = 'Keep the existing behaviour and add a feature flag for the new'
    expect(sixty).toHaveLength(62)
    const content = questionNotificationContent(
      {
        questions: [
          { question: 'Which?', multiSelect: false, options: [{ label: sixty }, { label: 'No' }] }
        ]
      },
      AT
    )
    expect(content.actions[0]!.label).toBe('Keep the existing b…')
    expect(content.actions[0]!.label).toHaveLength(20)
    // The body keeps the whole label, so the cut button can still be read.
    expect(content.body).toContain(`1 ${sixty}`)
  })

  /**
   * When the choices cannot be made from three buttons — more than three
   * options, a multi-select, or several questions — the one button opens the
   * app on that session's chat, where the full card is. Buttons that answered
   * PART of a question would be worse than none.
   */
  describe('when the shade cannot hold the answer', () => {
    /** The real four-option call, single-select (the real one is a multi-select). */
    const FOUR_OPTIONS = {
      questions: [{ ...ASK_USER_QUESTION_CLEANUP.questions[0]!, multiSelect: false }]
    }

    it.each([
      ['four options', FOUR_OPTIONS],
      ['a multi-select', ASK_USER_QUESTION_CLEANUP],
      ['two questions', ASK_USER_QUESTION_STACK_AND_LOOK]
    ])('offers a single Answer button that opens the app for %s', (_label, input) => {
      const content = questionNotificationContent(prompt(input), AT)
      expect(content.actions).toEqual([
        { identifier: QUESTION_ANSWER_ACTION, label: 'Answer', opensApp: true }
      ])
    })

    // Grok and OMP answer by pasted label plus Enter after a composer clear,
    // which is only safe behind the card's stale-input heal. The shade has
    // none, so their question opens the app rather than offering a digit that
    // would be wrong for them.
    it('offers only the Answer route for an agent whose selector the shade cannot drive', () => {
      const content = questionNotificationContent(prompt(ASK_USER_QUESTION_CONTEXT_RING), {
        agent: 'grok',
        location: 'NexOS / main'
      })
      expect(content.actions).toEqual([
        { identifier: QUESTION_ANSWER_ACTION, label: 'Answer', opensApp: true }
      ])
    })

    it('still says the first question and its choices, and how many more there are', () => {
      const content = questionNotificationContent(prompt(ASK_USER_QUESTION_STACK_AND_LOOK), AT)
      expect(content.title).toBe('Stack · NexOS / main')
      expect(content.body).toBe(
        "How should the new Android app be built on top of Orca's relay?\n" +
          '1 Fork Orca mobile (Expo/RN) (Recommended) · 2 Web app + Capacitor with real beUI · 3 Native Kotlin/Compose\n' +
          '+1 more question'
      )
    })

    it('says a multi-select is one', () => {
      const content = questionNotificationContent(prompt(ASK_USER_QUESTION_CLEANUP), AT)
      expect(content.body).toBe(
        'Which of these should I delete?\n' +
          '1 Tier 1 caches (~45 GB) (Recommended) · 2 Unreal Engine 5.2 (48 GB) · 3 Hugging Face models (22 GB) · 4 node_modules in old checkouts (~20 GB)\n' +
          'Pick any that apply'
      )
    })
  })

  // Degenerate: one option is one button (the free-text row is still not one).
  it('offers one button for a one-option question', () => {
    const content = questionNotificationContent(prompt(CODEX_REQUEST_USER_INPUT), {
      agent: 'codex',
      location: 'NexOS / main'
    })
    expect(content.actions).toEqual([{ identifier: 'question:0', label: 'Blue', pick: 0 }])
  })

  it('offers only the Answer route for a question with no options at all', () => {
    const content = questionNotificationContent(
      { questions: [{ question: 'What should it be called?', multiSelect: false, options: [] }] },
      AT
    )
    expect(content.actions).toEqual([
      { identifier: QUESTION_ANSWER_ACTION, label: 'Answer', opensApp: true }
    ])
    expect(content.body).toBe('What should it be called?')
  })

  describe('the title when there is no header', () => {
    const noHeader = {
      questions: [{ question: 'Deploy now?', options: [{ label: 'Yes' }, { label: 'No' }] }]
    }

    it('names the agent and the worktree', () => {
      expect(questionNotificationContent(prompt(noHeader), AT).title).toBe(
        'Claude has a question · NexOS / main'
      )
    })

    it('names Codex when Codex is asking', () => {
      expect(
        questionNotificationContent(prompt(noHeader), { agent: 'codex', location: 'NexOS / main' })
          .title
      ).toBe('Codex has a question · NexOS / main')
    })

    it('does not guess a worktree it was not told', () => {
      expect(
        questionNotificationContent(prompt(noHeader), { agent: 'claude', location: null }).title
      ).toBe('Claude has a question')
    })

    it('falls back to a plain word for an agent it has no name for', () => {
      expect(
        questionNotificationContent(prompt(noHeader), { agent: 'goose', location: null }).title
      ).toBe('Agent has a question')
    })
  })

  it('keeps a header on its own when there is no worktree to add', () => {
    expect(
      questionNotificationContent(prompt(ASK_USER_QUESTION_CONTEXT_RING), {
        agent: 'claude',
        location: null
      }).title
    ).toBe('Context ring')
  })

  // The body goes through the same styling as every other banner: Markdown
  // emphasis becomes the Unicode letterforms the shade can draw.
  it('styles Markdown in the question the way the other banners do', () => {
    const content = questionNotificationContent(
      {
        questions: [
          {
            question: 'Use `uv` or **pip**?',
            multiSelect: false,
            options: [{ label: 'uv' }, { label: 'pip' }]
          }
        ]
      },
      AT
    )
    expect(content.body).toBe(
      `Use ${styleText('uv', 'mono')} or ${styleText('pip', 'bold')}?\n1 uv · 2 pip`
    )
  })
})

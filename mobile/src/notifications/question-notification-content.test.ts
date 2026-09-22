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
  ANSWER_PLACEHOLDER_NUMBERS,
  ANSWER_PLACEHOLDER_PER_QUESTION,
  OTHER_PLACEHOLDER,
  QUESTION_ANSWER_ACTION,
  QUESTION_OTHER_ACTION,
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
  it('leads with the project and branch, then the header, and numbers the choices', () => {
    const content = questionNotificationContent(prompt(ASK_USER_QUESTION_CONTEXT_RING), AT)
    expect(content.title).toBe('NexOS / main · Context ring')
    expect(content.body).toBe(
      'Codex only reports context via /status, not continuously. How should the context indicator work?\n' +
        '1 Tap to refresh · 2 Skip it for Codex'
    )
  })

  // The user answers from the shade and never opens the app: a button per
  // choice, and a reply field for the "Other…" row the agent's selector draws
  // under every question. The typed text is the free-text answer.
  it('offers one button per choice, in order, and an Other reply field', () => {
    const content = questionNotificationContent(prompt(ASK_USER_QUESTION_CONTEXT_RING), AT)
    expect(content.actions).toEqual([
      { identifier: 'question:0', label: 'Tap to refresh', pick: 0 },
      { identifier: 'question:1', label: 'Skip it for Codex', pick: 1 },
      { identifier: QUESTION_OTHER_ACTION, label: 'Other…', textInput: { placeholder: OTHER_PLACEHOLDER } }
    ])
  })

  // Android draws at most three actions on a notification and drops the rest
  // without a word. Three choices fill it: the buttons stay (one tap each,
  // the likelier need) and the Other field is the one that gives way.
  it('keeps three choice buttons and gives up the Other field when they fill the shade', () => {
    const content = questionNotificationContent(prompt(ASK_USER_QUESTION_WHICH_LOGO), AT)
    expect(content.actions).toHaveLength(3)
    expect(content.actions.map((a) => a.label)).toEqual([
      'The app icon',
      'The agent session c…',
      'The notification ic…'
    ])
    expect(content.actions.some((a) => 'textInput' in a)).toBe(false)
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

    // One reply field takes option numbers or words, and the placeholder says
    // so. Nothing opens the app.
    it.each([
      ['four options', FOUR_OPTIONS],
      ['a multi-select', ASK_USER_QUESTION_CLEANUP]
    ])('offers a single Answer reply field that takes numbers or words for %s', (_label, input) => {
      const content = questionNotificationContent(prompt(input), AT)
      expect(content.actions).toEqual([
        {
          identifier: QUESTION_ANSWER_ACTION,
          label: 'Answer',
          textInput: { placeholder: ANSWER_PLACEHOLDER_NUMBERS }
        }
      ])
      expect(ANSWER_PLACEHOLDER_NUMBERS).toBe('Number(s), e.g. 2 or 1,3, or type your answer')
    })

    it('offers one reply field for several questions, asking for one answer each', () => {
      const content = questionNotificationContent(prompt(ASK_USER_QUESTION_STACK_AND_LOOK), AT)
      expect(content.actions).toEqual([
        {
          identifier: QUESTION_ANSWER_ACTION,
          label: 'Answer',
          textInput: { placeholder: ANSWER_PLACEHOLDER_PER_QUESTION }
        }
      ])
    })

    // Grok and OMP answer by pasted label plus Enter after a composer clear,
    // which is only safe behind the card's stale-input heal. The shade has
    // none, so their question is captioned and offers nothing to press: a
    // digit would be wrong for them, and opening the app is not on offer.
    it('offers no action at all for an agent whose selector the shade cannot drive', () => {
      const content = questionNotificationContent(prompt(ASK_USER_QUESTION_CONTEXT_RING), {
        agent: 'grok',
        location: 'NexOS / main'
      })
      expect(content.actions).toEqual([])
      expect(content.title).toBe('NexOS / main · Context ring')
    })

    // Every question has to be readable from the shade, since the reply
    // answers all of them at once; and the body says the format.
    it('says every question with its choices, and how to reply to them all', () => {
      const content = questionNotificationContent(prompt(ASK_USER_QUESTION_STACK_AND_LOOK), AT)
      expect(content.title).toBe('NexOS / main · Stack')
      expect(content.body).toBe(
        "Q1 How should the new Android app be built on top of Orca's relay?\n" +
          '1 Fork Orca mobile (Expo/RN) (Recommended) · 2 Web app + Capacitor with real beUI · 3 Native Kotlin/Compose\n' +
          'Q2 Which visual direction for the UI layer?\n' +
          "1 Claude app: warm cream/ink, serif headings (Recommended) · 2 Codex app: neutral white/black, sans-serif · 3 Keep Orca's graphite dark palette\n" +
          'Reply with one answer per question, separated by ;'
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

  // Degenerate: one option is one button, plus the Other field.
  it('offers one button and the Other field for a one-option question', () => {
    const content = questionNotificationContent(prompt(CODEX_REQUEST_USER_INPUT), {
      agent: 'codex',
      location: 'NexOS / main'
    })
    expect(content.actions).toEqual([
      { identifier: 'question:0', label: 'Blue', pick: 0 },
      { identifier: QUESTION_OTHER_ACTION, label: 'Other…', textInput: { placeholder: OTHER_PLACEHOLDER } }
    ])
  })

  // The vendored parser accepts `label: ''`; a button with no title would
  // register a category id with a hole in it and draw nothing to press.
  it('falls back to the Answer field when an option has no label to put on a button', () => {
    const content = questionNotificationContent(
      {
        questions: [
          { question: 'Which?', multiSelect: false, options: [{ label: '' }, { label: 'Yes' }] }
        ]
      },
      AT
    )
    expect(content.actions).toEqual([
      {
        identifier: QUESTION_ANSWER_ACTION,
        label: 'Answer',
        textInput: { placeholder: ANSWER_PLACEHOLDER_NUMBERS }
      }
    ])
  })

  it('offers only a free-text reply for a question with no options at all', () => {
    const content = questionNotificationContent(
      { questions: [{ question: 'What should it be called?', multiSelect: false, options: [] }] },
      AT
    )
    expect(content.actions).toEqual([
      { identifier: QUESTION_OTHER_ACTION, label: 'Other…', textInput: { placeholder: OTHER_PLACEHOLDER } }
    ])
    expect(content.body).toBe('What should it be called?')
  })

  describe('the title when there is no header', () => {
    const noHeader = {
      questions: [{ question: 'Deploy now?', options: [{ label: 'Yes' }, { label: 'No' }] }]
    }

    it('names the project and branch, then the agent', () => {
      expect(questionNotificationContent(prompt(noHeader), AT).title).toBe(
        'NexOS / main · Claude has a question'
      )
    })

    it('names Codex when Codex is asking', () => {
      expect(
        questionNotificationContent(prompt(noHeader), { agent: 'codex', location: 'NexOS / main' })
          .title
      ).toBe('NexOS / main · Codex has a question')
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

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Claude Android 1.261009.20: a tap outside the `/` (or `@`) menu closes it
// for the token it was showing; it stays shut while that token stands and
// comes back for the next one. The composer reports "outside" as its field
// losing focus with the menu up.

vi.mock('react-native', () => ({}))

import { useComposerSuggestions } from './use-composer-suggestions'
import { composerSuggestionInsertText } from './composer-suggestion-text'

const FILES = ['src/app.ts', 'src/session/chat.ts']
let shown: string[] = []

function Harness(props: { value: string; cursor: number; focused: boolean }) {
  const { suggestions } = useComposerSuggestions({
    value: props.value,
    cursor: props.cursor,
    agent: null,
    skills: [],
    filePaths: FILES,
    popoverSpace: 800,
    dockHeight: 120,
    focused: props.focused
  })
  shown = suggestions.map(composerSuggestionInsertText)
  return null
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  shown = []
})

function render(value: string, focused: boolean, cursor = value.length) {
  const element = createElement(Harness, { value, cursor, focused })
  act(() => {
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

describe('a tap outside the composer menu', () => {
  it('closes the menu for the token it was showing', () => {
    render('look at @app', true)
    expect(shown.length).toBeGreaterThan(0)
    render('look at @app', false)
    expect(shown).toEqual([])
  })

  it('keeps it shut when the field comes back and the same token is typed on', () => {
    render('look at @ap', true)
    render('look at @ap', false)
    render('look at @ap', true)
    expect(shown).toEqual([])
    render('look at @app', true)
    expect(shown).toEqual([])
  })

  it('opens it again for the next token', () => {
    render('look at @app', true)
    render('look at @app', false)
    render('look at @app ', true)
    expect(shown).toEqual([])
    render('look at @app and @chat', true)
    expect(shown).toEqual(['@src/session/chat.ts'])
  })

  it('never closes a menu the field did not leave, nor one opened without focus', () => {
    render('@chat', false)
    expect(shown).toEqual(['@src/session/chat.ts'])
    render('@chat', true)
    expect(shown).toEqual(['@src/session/chat.ts'])
  })

  it('does nothing when there is no menu up as focus leaves', () => {
    render('plain text', true)
    render('plain text', false)
    render('plain text @chat', true)
    expect(shown).toEqual(['@src/session/chat.ts'])
  })
})

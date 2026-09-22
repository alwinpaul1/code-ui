import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { Keyboard, type TextInput } from 'react-native'
import { COMPOSER_MENU_LAYOUT_MS, shouldRestoreComposerCaret } from './composer-caret-restore'

/** The slash menu's appearance moves the composer and Android drops the caret
 *  onto the button under the field. `onFocus` marks the user as typing.
 *  `onBlur` puts the caret back once that steal has happened, and gives up
 *  if the keyboard actually hides. */
export function useRestoreComposerCaret(
  input: RefObject<TextInput | null>,
  menuOpen: boolean
): { onFocus: () => void; onBlur: () => void } {
  const typing = useRef(false)
  const dismissed = useRef(false)
  const menuOpenRef = useRef(menuOpen)
  const changedAtRef = useRef(Number.NEGATIVE_INFINITY)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const clearTimers = (): void => {
    for (const timer of timers.current) {
      clearTimeout(timer)
    }
    timers.current = []
  }
  useEffect(() => {
    // Recording mounts replace Keyboard with a dismiss-only stub. A missing
    // listener must not throw there; the phone's Keyboard has the method.
    if (typeof Keyboard.addListener !== 'function') {
      return
    }
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      dismissed.current = true
      typing.current = false
      clearTimers()
    })
    return () => sub.remove()
  }, [])
  useLayoutEffect(() => {
    if (menuOpenRef.current !== menuOpen) {
      changedAtRef.current = Date.now()
    }
    menuOpenRef.current = menuOpen
  }, [menuOpen])
  useEffect(() => {
    if (!typing.current || dismissed.current) {
      return
    }
    const handle = requestAnimationFrame(() => {
      if (!typing.current || dismissed.current || !Keyboard.isVisible()) {
        return
      }
      input.current?.focus()
    })
    return () => cancelAnimationFrame(handle)
  }, [input, menuOpen])
  useEffect(() => clearTimers, [])
  const onFocus = useCallback(() => {
    dismissed.current = false
    typing.current = true
  }, [])
  const onBlur = useCallback(() => {
    if (dismissed.current) {
      return
    }
    const timer = setTimeout(() => {
      timers.current = timers.current.filter((entry) => entry !== timer)
      if (dismissed.current) {
        return
      }
      if (
        !shouldRestoreComposerCaret({
          typing: typing.current,
          keyboardVisible: Keyboard.isVisible(),
          menuOpen: menuOpenRef.current,
          sinceMenuChangeMs: Date.now() - changedAtRef.current
        })
      ) {
        return
      }
      input.current?.focus()
    }, COMPOSER_MENU_LAYOUT_MS)
    timers.current.push(timer)
  }, [input])
  return { onFocus, onBlur }
}

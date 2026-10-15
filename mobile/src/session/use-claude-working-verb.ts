import { useEffect, useState } from 'react'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { CLAUDE_WORKING_VERBS, randomVerbIndex, verbChangeDelayMs } from './claude-working-footer-spec'

/**
 * The word the Claude app's working line shows, with no ellipsis: a random one when the line starts
 * working, another after 3 s, another after 4 s more, then one every 6 s (`l8`, see
 * claude-working-footer-spec.ts). Under reduced motion, and until the OS has answered, it keeps
 * "Clauding", the first word, as the app does when motion is reduced.
 */
export function useClaudeWorkingVerb(working: boolean): string {
  const reducedMotion = useReducedMotion()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!working || reducedMotion !== false) {
      return undefined
    }
    let changes = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    setIndex(randomVerbIndex())
    const schedule = () => {
      timer = setTimeout(() => {
        setIndex(randomVerbIndex())
        changes += 1
        schedule()
      }, verbChangeDelayMs(changes))
    }
    schedule()
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [working, reducedMotion])
  return CLAUDE_WORKING_VERBS[index] ?? CLAUDE_WORKING_VERBS[0]
}

import { useEffect, useRef, useState } from 'react'
import { isUnknownMobileFileName } from './mobile-file-language'
import { detectMobileSyntaxLanguage, resolveMobileSyntaxLanguage } from './mobile-file-syntax'

/** What the found language is kept against: a file with the same name and
 *  first characters is the same file, however its end changes. */
const DETECT_KEY_CHARS = 4_096

/**
 * The highlighter's language for a file in a code viewer. By its name when
 * the name places it, at once; otherwise the file is drawn plain and read
 * for what its text declares a tick later, off the first paint, the way
 * colours arrive (review, 2026-09-27: reading ran in render, on every open
 * and every content update). The answer is kept against the name and first
 * 4 KB, so a file growing at its end is not read again.
 */
export function useMobileSyntaxLanguage(filePath: string, content: string, preferredLanguage?: string): string {
  const byName = resolveMobileSyntaxLanguage(filePath, preferredLanguage)
  const key =
    byName === 'plaintext' && isUnknownMobileFileName(filePath)
      ? `${filePath}\u0000${content.slice(0, DETECT_KEY_CHARS)}`
      : null
  const [detected, setDetected] = useState<{ key: string; language: string } | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const known = key !== null && detected?.key === key
  useEffect(() => {
    if (key === null || known) {
      return undefined
    }
    const timer = setTimeout(() => {
      setDetected({ key, language: detectMobileSyntaxLanguage(contentRef.current, filePath) ?? 'plaintext' })
    }, 0)
    return () => clearTimeout(timer)
  }, [filePath, key, known])
  return key !== null && detected?.key === key ? detected.language : byName
}

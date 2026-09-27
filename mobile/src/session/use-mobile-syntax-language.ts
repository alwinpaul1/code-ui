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
  // The language found, by path; the key it was found for is a ref, so an
  // edit near the top that reads the same language again renders nothing.
  const [detected, setDetected] = useState<{ path: string; language: string } | null>(null)
  const detectedKey = useRef<string | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  useEffect(() => {
    if (key === null || detectedKey.current === key) {
      return undefined
    }
    const timer = setTimeout(() => {
      detectedKey.current = key
      const language = detectMobileSyntaxLanguage(contentRef.current, filePath) ?? 'plaintext'
      setDetected((previous) =>
        previous?.path === filePath && previous.language === language ? previous : { path: filePath, language }
      )
    }, 0)
    return () => clearTimeout(timer)
  }, [filePath, key])
  // While an edit near the top is read again, the same file keeps the
  // language it had: falling back to plain for that tick built its document
  // twice and reset its folds (review, 2026-09-27).
  return key !== null && detected?.path === filePath ? detected.language : byName
}

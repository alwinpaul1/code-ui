/** The exact `@file` token the composer's `@`-autocomplete inserts for a
 *  worktree-relative path (`composerSuggestionInsertText`'s `'file'` case)
 *  and that the file reader's "Ask about lines"/"Ask about file" actions
 *  insert too — one function so the two surfaces can never drift apart. Pure
 *  and React-Native-free on purpose: both a plain unit test and a component
 *  test can import it without pulling in a native module. */
export function formatNativeChatFileMentionToken(relativePath: string): string {
  return `@${relativePath}`
}

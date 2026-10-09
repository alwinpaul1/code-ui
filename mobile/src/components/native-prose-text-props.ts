import type { MarkdownTypography } from './mobile-markdown-prose-scale'
import type { NativeProseLink, NativeProseModel } from './native-prose-model'

export type NativeProseTextProps = {
  model: NativeProseModel
  typography: MarkdownTypography
  textScale: number
  /** The run's width in dp, from the document's layout. */
  width: number
  selectable: boolean
  onLink: (link: NativeProseLink) => void
  /** Called once the native side has refused to measure this spec (the log
   *  says why): the document then draws its runs as React Native Texts. */
  onRefused: () => void
}

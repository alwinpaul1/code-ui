import { routeNativeChatHref } from '../../../src/shared/native-chat-href-routing'
import { markdownLinkDestination } from './markdown-link-destination'

export type MarkdownHrefRoute =
  | { kind: 'web'; url: string }
  | { kind: 'file'; pathText: string }
  | { kind: 'none' }

function withLineSuffix(pathText: string, line: number | null): string {
  return line === null ? pathText : `${pathText}:${line}`
}

/** Where a link opens: its address without its title, as the reply's Copy
 *  pastes it (markdown-link-destination.ts). */
export function routeMarkdownHref(href: string): MarkdownHrefRoute {
  const route = routeNativeChatHref(markdownLinkDestination(href))
  if (route.kind !== 'file') {
    return route
  }
  return { kind: 'file', pathText: withLineSuffix(route.pathText, route.line) }
}

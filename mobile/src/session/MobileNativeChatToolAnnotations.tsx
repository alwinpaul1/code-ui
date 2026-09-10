// The mobile half of Orca #19226 (d0506bf5d): what a tool row can say about
// itself beyond its name — the MCP server it reached, the code it exited with,
// how long it took, and the pages a web search actually returned.
//
// Everything here is drawn only from what the provider stated. A row with no
// metadata renders nothing extra rather than a guessed figure.

import { Linking, Pressable, Text, View } from 'react-native'
import {
  formatToolDuration,
  mcpToolIdentity,
  toolWebSearchResults,
  type NativeChatMcpIdentity
} from '../../../src/shared/native-chat-tool-identity'
import type { NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'

/** An MCP call reads as `server / tool`, not as the `mcp__server__tool` token
 *  the provider transports it under. Anything else keeps its own name. */
export function ToolRowName({
  name,
  mcpIdentity,
  styles
}: {
  name: string
  mcpIdentity?: NativeChatMcpIdentity
  styles: ChatMessageStyles
}): React.JSX.Element {
  const identity = mcpToolIdentity(name, mcpIdentity)
  if (!identity) {
    return <Text style={styles.toolName}>{name}</Text>
  }
  return (
    <Text style={styles.toolName} numberOfLines={1} accessibilityLabel={name}>
      <Text testID="tool-mcp-server" style={styles.toolNameServer}>
        {identity.server}
      </Text>
      <Text style={styles.toolNameSeparator}>{' / '}</Text>
      <Text testID="tool-mcp-tool" style={styles.toolNameTool}>
        {identity.tool}
      </Text>
    </Text>
  )
}

/** Exit code and duration, when the provider reported them. A non-zero exit is
 *  the one figure here that changes the row's meaning, so it is the one that
 *  takes the danger tone. */
export function ToolExecutionMeta({
  block,
  styles
}: {
  block: NativeChatToolCallBlock
  styles: ChatMessageStyles
}): React.JSX.Element | null {
  const duration = formatToolDuration(block.durationMs)
  const exitCode = Number.isSafeInteger(block.exitCode) ? block.exitCode : undefined
  if (exitCode === undefined && duration === null) {
    return null
  }
  return (
    <View style={styles.toolMeta}>
      {exitCode === undefined ? null : (
        <Text
          testID="tool-exit-code"
          style={[styles.toolMetaText, exitCode !== 0 && styles.toolMetaFailed]}
        >
          {`exit ${exitCode}`}
        </Text>
      )}
      {duration ? (
        <Text testID="tool-duration" style={styles.toolMetaText}>
          {duration}
        </Text>
      ) : null}
    </View>
  )
}

/** The pages a web search returned, each one tappable. The provider's full
 *  output stays behind the row as the detail fallback. */
export function ToolSearchResults({
  results,
  styles
}: {
  results: NativeChatToolCallBlock['webSearchResults']
  styles: ChatMessageStyles
}): React.JSX.Element | null {
  const hits = toolWebSearchResults(results)
  if (hits.length === 0) {
    return null
  }
  return (
    <View style={styles.toolSearchResults}>
      {hits.map((hit) => (
        <Pressable
          key={hit.url}
          onPress={() => void Linking.openURL(hit.url).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel={hit.url}
          hitSlop={4}
        >
          <Text testID="tool-search-title" style={styles.toolSearchTitle} numberOfLines={2}>
            {hit.title}
          </Text>
          {hit.title === hit.url ? null : (
            <Text style={styles.toolSearchUrl} numberOfLines={1}>
              {hit.url}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  )
}

import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatFileSearch } from './use-mobile-native-chat-file-search'
import { useMobileNativeChatSkills } from './use-mobile-native-chat-skills'

/** The composer's two lazy autocomplete catalogs: `@` file paths and `/` skills. */
export function useMobileNativeChatComposerCatalogs(args: {
  client: RpcClient | null
  worktreeId: string
}) {
  const files = useMobileNativeChatFileSearch(args)
  const skills = useMobileNativeChatSkills(args)
  return { ...files, ...skills }
}

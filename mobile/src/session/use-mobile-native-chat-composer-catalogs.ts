import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatFileSearch } from './use-mobile-native-chat-file-search'
import { useMobileNativeChatSkills } from './use-mobile-native-chat-skills'

/** The composer's two lazy autocomplete catalogs: `@` file paths and `/` skills. */
export function useMobileNativeChatComposerCatalogs(args: {
  client: RpcClient | null
  worktreeId: string
  /** The chat's transcript path, which names the Claude config dir whose
   *  skills the `/` menu lists. */
  transcriptPath: string | null
}) {
  const { client, worktreeId } = args
  const files = useMobileNativeChatFileSearch({ client, worktreeId })
  const skills = useMobileNativeChatSkills(args)
  return { ...files, ...skills }
}

import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatFileSearch } from './use-mobile-native-chat-file-search'
import { useMobileNativeChatSkills, type SkillsMenuChat } from './use-mobile-native-chat-skills'

/** The composer's two lazy autocomplete catalogs: `@` file paths and `/` skills. */
export function useMobileNativeChatComposerCatalogs(args: {
  client: RpcClient | null
  worktreeId: string
  /** The active tab's chat, whichever view the tab shows; its transcript
   *  names the Claude config dir whose skills the `/` menu lists. */
  chatIdentity: SkillsMenuChat | null
}) {
  const { client, worktreeId } = args
  const files = useMobileNativeChatFileSearch({ client, worktreeId })
  const skills = useMobileNativeChatSkills(args)
  return { ...files, ...skills }
}

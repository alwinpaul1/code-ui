import type { RpcClient } from '../transport/rpc-client'
import { statRead } from '../files/mobile-file-media-download'

/** The most a chat picture may weigh before the phone asks for its bytes.
 *  It is drawn as a 96 dp tile; a file over this is a photo export or a
 *  raw capture, and its base64 would cross the relay at a third more again.
 *  The desktop's own preview cap is 10 MB (Orca 1.4.224). Checked only where
 *  the desktop answers `files.stat`: a file in a worktree. A file outside
 *  every workspace is read on a grant, which has no stat; its cap is the
 *  desktop's. */
export const AGENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024

/** A worktree file's size, or null when the desktop will not say (a host
 *  that keeps `files.stat` from phones, a failed ask): the read goes ahead
 *  then, capped by the desktop, rather than a picture lost to a missing stat. */
export async function worktreeFileSize(
  client: RpcClient,
  params: { worktree: string; relativePath: string }
): Promise<number | null> {
  try {
    const reply = await statRead.request(client, params, { timeoutMs: 15_000 })
    if (!reply.ok) {
      return null
    }
    const stat = statRead.interpret(reply)
    return stat.isDirectory ? null : stat.size
  } catch {
    return null
  }
}

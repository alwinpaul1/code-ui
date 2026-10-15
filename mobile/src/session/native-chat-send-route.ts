import { claudeComposerSend } from './claude-composer-send-route'

type Send = (text: string) => Promise<boolean>

/**
 * The composer's Send (MobileNativeChatOverlay.tsx):
 *  - a Claude tab whose attachments go through Anthropic too (the switch in ccr-file-upload.ts is
 *    on): words and finished chips in one event (`images.sendAnthropic`), chips or not; a slash
 *    command still types into the terminal, as claude-composer-send-route.ts decides;
 *  - a Claude tab on the Anthropic lane otherwise: the words through Anthropic, and anything with a
 *    chip through the desktop (the chip's bytes are on the desktop while the switch is off);
 *  - every other tab, Codex and every other agent included: the desktop path.
 */
export function nativeChatComposerSend(
  controller: { nativeChatAnthropicSend?: Send; nativeChatAnthropicAttachments?: unknown },
  images: { sendNativeChat: Send; sendAnthropic: Send; attachments: readonly unknown[] }
): Send {
  if (controller.nativeChatAnthropicAttachments) {
    return claudeComposerSend(images.sendAnthropic, images.sendNativeChat, () => 0)
  }
  return claudeComposerSend(controller.nativeChatAnthropicSend, images.sendNativeChat, () => images.attachments.length)
}

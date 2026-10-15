import { claudeComposerSend } from './claude-composer-send-route'

type Send = (text: string) => Promise<boolean>
type AppCommand = (text: string) => boolean

/**
 * The composer's Send (MobileNativeChatOverlay.tsx):
 *  - a Claude tab whose attachments go through Anthropic too (the switch in ccr-file-upload.ts is
 *    on): words and finished chips in one event (`images.sendAnthropic`), chips or not; a slash
 *    command still types into the terminal, as claude-composer-send-route.ts decides;
 *  - a Claude tab on the Anthropic lane otherwise: the words through Anthropic, and anything with a
 *    chip through the desktop (the chip's bytes are on the desktop while the switch is off);
 *  - every other tab, Codex and every other agent included: the desktop path.
 *
 * Before any of that, a matched Claude tab's `nativeChatAppCommand` takes the Claude app's own
 * `/model`, `/diff` and `/workflows`, which open a phone sheet and are never sent (iu7.a,
 * ay8.java:8650; claude-app-commands.ts). A send with a chip is never taken: the file goes.
 */
export function nativeChatComposerSend(
  controller: { nativeChatAnthropicSend?: Send; nativeChatAnthropicAttachments?: unknown; nativeChatAppCommand?: AppCommand },
  images: { sendNativeChat: Send; sendAnthropic: Send; attachments: readonly unknown[] }
): Send {
  const send = controller.nativeChatAnthropicAttachments
    ? claudeComposerSend(images.sendAnthropic, images.sendNativeChat, () => 0)
    : claudeComposerSend(controller.nativeChatAnthropicSend, images.sendNativeChat, () => images.attachments.length)
  // Read per render, as claudeComposerSend reads them: the composer draws again when a chip comes or goes.
  return controller.nativeChatAppCommand && images.attachments.length === 0 ? withAppCommands(controller.nativeChatAppCommand, send) : send
}

const taking = new WeakMap<AppCommand, WeakMap<Send, Send>>()

/** The same pair always yields the same function, so the composer's `onSend` keeps its identity. */
function withAppCommands(appCommand: AppCommand, send: Send): Send {
  let bySend = taking.get(appCommand)
  if (!bySend) {
    bySend = new WeakMap()
    taking.set(appCommand, bySend)
  }
  let wrapped = bySend.get(send)
  if (!wrapped) {
    wrapped = (text) => (appCommand(text) ? Promise.resolve(true) : send(text))
    bySend.set(send, wrapped)
  }
  return wrapped
}

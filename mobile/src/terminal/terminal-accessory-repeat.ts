export const TERMINAL_ACCESSORY_REPEAT_DELAY_MS = 400
export const TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS = 45

type TerminalAccessoryRepeatSender<TInput> = (input: TInput) => Promise<boolean>
type TerminalAccessoryRepeatSendToTerminal<TInput> = (
  input: TInput,
  targetHandle: string,
  isDeliveryTargetCurrent: () => boolean
) => Promise<boolean>

export function createTerminalAccessoryRepeatSender<TInput>(
  targetHandle: string | null,
  isDeliveryTargetCurrent: (targetHandle: string) => boolean,
  sendToTerminal: TerminalAccessoryRepeatSendToTerminal<TInput>
): TerminalAccessoryRepeatSender<TInput> {
  return (input) => {
    if (!targetHandle || !isDeliveryTargetCurrent(targetHandle)) {
      return Promise.resolve(false)
    }
    return sendToTerminal(input, targetHandle, () => isDeliveryTargetCurrent(targetHandle))
  }
}

export function createTerminalAccessoryRepeatController<TInput>() {
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  // Whether the current press has emitted at least one send. Lets a held key
  // that already auto-repeated skip the tap send on release.
  let fired = false

  const stop = () => {
    generation += 1
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const cancel = stop

  const scheduleFor = (
    activeGeneration: number,
    input: TInput,
    send: TerminalAccessoryRepeatSender<TInput>,
    delayMs: number
  ) => {
    timer = setTimeout(() => {
      timer = null
      if (generation !== activeGeneration) {
        return
      }
      fired = true
      void send(input).then(
        (sent) => {
          if (sent && generation === activeGeneration) {
            scheduleFor(activeGeneration, input, send, TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS)
          }
        },
        () => undefined
      )
    }, delayMs)
  }

  /** Send immediately, then auto-repeat while held. */
  const start = (input: TInput, send: TerminalAccessoryRepeatSender<TInput>) => {
    stop()
    fired = true
    const activeGeneration = generation
    const pressedAt = Date.now()

    void send(input).then(
      (sent) => {
        if (sent && generation === activeGeneration) {
          scheduleFor(
            activeGeneration,
            input,
            send,
            Math.min(
              TERMINAL_ACCESSORY_REPEAT_DELAY_MS,
              Math.max(0, TERMINAL_ACCESSORY_REPEAT_DELAY_MS - (Date.now() - pressedAt))
            )
          )
        }
      },
      () => undefined
    )
  }

  /**
   * Arm a repeat without sending yet. The first send lands only once the key
   * has been HELD for the repeat delay; a quick tap that releases before then
   * emits nothing here, and the caller sends once on release instead.
   *
   * Why (#12251): the accessory strip is a horizontal ScrollView. Sending on
   * press-in meant every swipe that started on an arrow key fired that key
   * before the scroll gesture took over, so scrolling the strip typed into
   * the terminal. Deferring the first byte to release-or-hold makes a swipe
   * (press-in → scroll steals touch → press-out, no press) emit nothing.
   */
  const startHeld = (input: TInput, send: TerminalAccessoryRepeatSender<TInput>) => {
    stop()
    fired = false
    scheduleFor(generation, input, send, TERMINAL_ACCESSORY_REPEAT_DELAY_MS)
  }

  const hasFired = () => fired

  return { cancel, hasFired, start, startHeld, stop }
}

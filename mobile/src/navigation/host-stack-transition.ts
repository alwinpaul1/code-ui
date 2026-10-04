/** The slice of an expo-router route the page's stack needs: only its key. */
type KeyedRoute = { readonly key: string }

/** A pop needs no under key: the screen beneath it is always the new top. */
export type HostStackTransition<Route extends KeyedRoute, Descriptors> =
  | Readonly<{ kind: 'push'; enteringKey: string; underKey: string }>
  | Readonly<{ kind: 'pop'; leaving: Route; descriptors: Descriptors }>

/** Push = the old top is still in the stack below the new one; pop = the old top left it. */
export function hostStackTransitionBetween<Route extends KeyedRoute, Descriptors>(
  previous: Readonly<{ routes: readonly Route[]; descriptors: Descriptors }>,
  next: readonly Route[]
): HostStackTransition<Route, Descriptors> | null {
  const previousTop = previous.routes.at(-1)
  const nextTop = next.at(-1)
  if (!previousTop || !nextTop || previousTop.key === nextTop.key) {
    return null
  }
  const nextKeys = next.map((route) => route.key)
  if (nextKeys.at(-2) === previousTop.key) {
    return { kind: 'push', enteringKey: nextTop.key, underKey: previousTop.key }
  }
  if (!nextKeys.includes(previousTop.key) && previous.routes.some((r) => r.key === nextTop.key)) {
    return { kind: 'pop', leaving: previousTop, descriptors: previous.descriptors }
  }
  // A replace or a reset has no direction to slide in.
  return null
}

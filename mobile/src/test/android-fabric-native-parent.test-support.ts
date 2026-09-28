/**
 * Which native view Fabric on Android mounts a host node into, for tests
 * that render with the host-tag 'react-native' mock. A model of React Native
 * 0.86.3, pinned against its source by the tests that use it:
 *
 * - A node keeps its children as its own native subviews when it forms a
 *   stacking context, or when its own parent has collapsableChildren={false}
 *   (ChildrenFormStackingContext). Any other node is flattened, and its
 *   children go to the nearest ancestor that keeps them
 *   (mounting/internal/sliceChildShadowNodeViewPairs.cpp, `areChildrenFlattened`).
 * - A View forms a stacking context per `formsStackingContext` below.
 * - A Text never forms one on Android. The outermost one is a Paragraph,
 *   whose Android traits unset FormsStackingContext (ParagraphShadowNode.h).
 *   A nested one is a TextShadowNode, which forms a view but no stacking
 *   context (TextShadowNode.h). So a Text keeps its inline Views only under a
 *   parent with collapsableChildren={false}; otherwise they are mounted into
 *   the nearest ancestor that keeps its children.
 */

type Style = Record<string, unknown>

/** Every prop Fabric parses into ViewEvents; any of them makes a stacking context. */
const VIEW_EVENT_PROP =
  /^on(Click|Pointer|Touch|Responder|StartShouldSetResponder|MoveShouldSetResponder|ShouldBlockNativeResponder)/

const BORDER_WIDTH_STYLE = /^border(Top|Right|Bottom|Left|Start|End|Horizontal|Vertical|Block|BlockStart|BlockEnd|Inline|InlineStart|InlineEnd)?Width$/

export function flattenStyle(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle)) as Style
  }
  return style && typeof style === 'object' ? (style as Style) : {}
}

/** `formsStackingContext` from ViewShadowNode::initialize, React Native 0.86.3
 *  (ReactCommon/react/renderer/components/view/ViewShadowNode.cpp), plus the
 *  Android host trait (`elevation`). `onLayout` is not in it: it is a plain
 *  bool on BaseViewProps, not a ViewEvents bit, so a View that only listens
 *  for its layout is flattened. */
export function formsStackingContext(props: Record<string, unknown>): boolean {
  const style = flattenStyle(props.style)
  const pointerEvents = props.pointerEvents ?? style.pointerEvents
  const transform = style.transform
  return (
    props.collapsable === false ||
    pointerEvents === 'none' ||
    pointerEvents === 'box-only' ||
    Boolean(props.nativeID) ||
    props.accessible === true ||
    (style.opacity !== undefined && style.opacity !== 1) ||
    (Array.isArray(transform) ? transform.length > 0 : Boolean(transform)) ||
    // RN's default position is relative, so any zIndex counts unless static.
    (style.zIndex !== undefined && style.position !== 'static') ||
    style.display === 'none' ||
    (style.overflow !== undefined && style.overflow !== 'visible') ||
    Object.keys(props).some((key) => VIEW_EVENT_PROP.test(key)) ||
    (style.shadowColor !== undefined && style.shadowColor !== 'transparent') ||
    props.accessibilityElementsHidden === true ||
    props.accessibilityViewIsModal === true ||
    (props.importantForAccessibility !== undefined && props.importantForAccessibility !== 'auto') ||
    props.removeClippedSubviews === true ||
    (style.cursor !== undefined && style.cursor !== 'auto') ||
    Boolean(style.filter) ||
    (style.mixBlendMode !== undefined && style.mixBlendMode !== 'normal') ||
    style.isolation === 'isolate' ||
    (style.elevation !== undefined && style.elevation !== 0) ||
    (Array.isArray(props.accessibilityOrder) && props.accessibilityOrder.length > 0)
  )
}

/** `formsView` from the same function: whether the View exists natively at
 *  all. One that does not is flattened away and its children hoisted. */
export function formsView(props: Record<string, unknown>): boolean {
  const style = flattenStyle(props.style)
  const hasItems = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value))
  return (
    formsStackingContext(props) ||
    (style.backgroundColor !== undefined && style.backgroundColor !== 'transparent') ||
    Object.keys(style).some((key) => BORDER_WIDTH_STYLE.test(key) && style[key] !== undefined) ||
    Boolean(props.testID) ||
    hasItems(style.boxShadow) ||
    hasItems(style.experimental_backgroundImage ?? style.backgroundImage) ||
    (typeof style.outlineWidth === 'number' && style.outlineWidth > 0) ||
    // Android's host traits.
    props.nativeBackgroundAndroid !== undefined ||
    props.nativeForegroundAndroid !== undefined ||
    props.focusable === true ||
    props.hasTVPreferredFocus === true ||
    props.needsOffscreenAlphaCompositing === true ||
    props.renderToHardwareTextureAndroid === true ||
    props.screenReaderFocusable === true
  )
}

/** A host node as the renderer shows it: its tag, props and host parent. */
export type HostLike = { type: unknown; props: Record<string, unknown>; parent: HostLike | null }

/** Whether a host node keeps its children as its own native subviews on
 *  Android: a View when it forms a stacking context, a Text never, any other
 *  host (a ScrollView's content view, a Pressable, a native leaf) always, and
 *  any node at all whose parent has collapsableChildren={false}. */
export function keepsChildrenOnAndroid(node: HostLike, parent: HostLike | null): boolean {
  if (parent?.props.collapsableChildren === false) {
    return true
  }
  if (node.type === 'View') {
    return formsStackingContext(node.props)
  }
  return node.type !== 'Text'
}

/** The host node Fabric on Android mounts `node` into: the nearest host
 *  ancestor that keeps its children, or null when none is in the rendered
 *  tree (it goes to whatever the tree is drawn in). `hostParent` walks one
 *  host level up. */
export function androidNativeParent<T extends HostLike>(node: T, hostParent: (node: T) => T | null): T | null {
  for (let up = hostParent(node); up; up = hostParent(up)) {
    if (keepsChildrenOnAndroid(up, hostParent(up))) {
      return up
    }
  }
  return null
}

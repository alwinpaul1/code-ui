/**
 * The shape of xterm, as the document uses it.
 *
 * Only the members the document's own code reaches: the terminal, its buffer, the internals the
 * OSC 8 lookup and the cell-geometry walk go through, and its two addons. This describes the
 * engine rather than the document, which is why it is not in the scope's own file: the WebView's
 * engine is a bundle on `window` and the page's is an import, and both answer exactly this.
 */

/** xterm's OSC 8 link service, reached through internals and always guarded. */
export type TerminalOscLinkService = { getLinkData?: (id: number) => { uri?: string } | undefined }

/** The xterm internals the OSC 8 lookup walks. */
export type TerminalDocumentCore = {
  _renderService?: { dimensions?: { css: { cell: { height: number; width: number } } } }
  _oscLinkService?: TerminalOscLinkService
  _inputHandler?: { _oscLinkService?: TerminalOscLinkService }
  /** Read by `query-reply`'s DECRQM answer: whether the cursor is hidden (DECTCEM). */
  coreService?: { isCursorHidden?: boolean }
  /** Read by `query-reply`'s DECRQM answer: the mouse report encoding in force. */
  coreMouseService?: { activeEncoding?: string }
}

/** An OSC 8 link the host captured from scrollback before xterm replayed it. */
export type TerminalInitialOscLink = {
  uri?: string
  row: number
  startCol: number
  endCol: number
  text?: string
}

/**
 * One cell of a buffer line, as the document inspects it.
 *
 * The attribute getters answer numbers, which is xterm's own signature for them and the reason
 * every reader here is a truthiness test rather than a comparison.
 */
export type TerminalDocumentCell = {
  isBgDefault: () => boolean
  extended?: { urlId?: number }
  isInverse: () => number
  isUnderline?: () => number
  isStrikethrough?: () => number
  isOverline?: () => number
}

/** One buffer line, as the document inspects it. */
export type TerminalDocumentLine = {
  readonly length: number
  translateToString: (trimRight: boolean, startColumn?: number, endColumn?: number) => string
  getCell?: (x: number, cell?: TerminalDocumentCell) => TerminalDocumentCell | undefined
}

/** One side of xterm's buffer, as the document reads it. */
export type TerminalDocumentBuffer = {
  readonly length: number
  readonly viewportY: number
  readonly baseY: number
  readonly cursorY: number
  readonly type: string
  getNullCell?: () => TerminalDocumentCell
  getLine: (index: number) => TerminalDocumentLine | undefined
}

/** As much of xterm's terminal as the document's own code touches. */
/** A terminal colour theme: xterm reads it as a flat map of slot to CSS colour. */
export type TerminalDocumentTheme = Record<string, string>

/** The xterm options the document writes; each field is owned by the group that sets it. */
export type TerminalDocumentTerminalOptions = {
  theme: TerminalDocumentTheme
  minimumContrastRatio: number
  fontSize: number
  /** Read, never written, by `query-reply`'s DECRQM answer (LNM, mode 20). */
  convertEol?: boolean
  /** Read, never written, by `query-reply`'s DECRQM answer (mode 12). */
  cursorBlink?: boolean
}

/** A CSI handler registration, as xterm's parser takes one. */
export type TerminalDocumentCsiHandlerId = {
  prefix?: string
  intermediates?: string
  final: string
}

/** As much of xterm's parser as the document hooks: `query-reply` answers DECRQM through it. */
export type TerminalDocumentParser = {
  registerCsiHandler: (
    id: TerminalDocumentCsiHandlerId,
    callback: (params: (number | number[])[]) => boolean
  ) => TerminalDocumentDisposable
}

/** xterm's public mode flags. The first three drive the host mirror; the rest answer DECRQM. */
export type TerminalDocumentPublicModes = {
  bracketedPasteMode?: boolean
  mouseTrackingMode?: string
  applicationCursorKeysMode?: boolean
  insertMode?: boolean
  originMode?: boolean
  wraparoundMode?: boolean
  reverseWraparoundMode?: boolean
  applicationKeypadMode?: boolean
  sendFocusMode?: boolean
  synchronizedOutputMode?: boolean
}

export type TerminalDocumentTerminal = {
  readonly cols: number
  readonly rows: number
  readonly buffer: { readonly active: TerminalDocumentBuffer }
  options: TerminalDocumentTerminalOptions
  write: (data: string, callback?: () => void) => void
  open: (element: HTMLElement) => void
  scrollToLine: (line: number) => void
  clear: () => void
  reset: () => void
  selectAll: () => void
  getSelection?: () => string
  select: (col: number, row: number, length: number) => void
  clearSelection: () => void
  readonly unicode: { activeVersion: string }
  attachCustomKeyEventHandler: (handler: () => boolean) => void
  onData: (listener: (data: string) => void) => TerminalDocumentDisposable
  readonly textarea?: {
    readOnly: boolean
    tabIndex: number
    setAttribute: (name: string, value: string) => void
  }
  readonly element?: HTMLElement
  readonly _core?: TerminalDocumentCore
  readonly modes?: TerminalDocumentPublicModes
  readonly parser: TerminalDocumentParser
  onLineFeed?: (listener: () => void) => TerminalDocumentDisposable
  onScroll?: (listener: () => void) => TerminalDocumentDisposable
  /** `term-observers`: fires on the frame xterm actually paints, which the scroll remainder syncs to. */
  onRender?: (listener: () => void) => TerminalDocumentDisposable
  onWriteParsed?: (listener: () => void) => TerminalDocumentDisposable
  resize: (cols: number, rows: number) => void
  refresh: (start: number, end: number) => void
  dispose: () => void
  loadAddon: (addon: TerminalDocumentWebglAddon) => void
  scrollToBottom: () => void
  scrollLines: (amount: number) => void
}

/** An xterm listener handle, as the document disposes of one. */
export type TerminalDocumentDisposable = { dispose?: () => void }

/** xterm's WebGL addon, as the document loads, repaints and disposes of it. */
export type TerminalDocumentWebglAddon = {
  onContextLoss?: (listener: () => void) => void
  clearTextureAtlas?: () => void
  dispose: () => void
}

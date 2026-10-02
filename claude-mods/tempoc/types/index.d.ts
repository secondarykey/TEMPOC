/** One usage window as the last API response reported it. */
export type TempocWindow = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string
  /** Amount used, 0 to 100. */
  percentUsed: number
  /** When the window resets, epoch milliseconds; null when unknown. */
  resetsAt: number | null
}

/**
 * What the band draws: the windows and the moment they are drawn against, set
 * together so that one new reading redraws (and reloads the Svg) once.
 */
export type TempocView = {
  windows: TempocWindow[]
  /** Epoch milliseconds the drawing is built against. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    tempoc: {
      windows: TempocWindow[]
      view: TempocView
      /** True while the person has closed the bars; the status bar offers them back. */
      isHidden: boolean
    }
  }
}

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

/** When one window's bar turns Warning or Danger color. */
export type TempocThresholds = {
  isEnabled: boolean
  /** Points by which usage must exceed elapsed time. */
  warning: number
  danger: number
}

/** The color settings, the same items and defaults as the extension's and the desktop app's. */
export type TempocSettings = {
  hour5: TempocThresholds
  day7: TempocThresholds
  /** Usage percent that turns any bar, whatever the elapsed time. */
  utilizationWarning: number
  utilizationDanger: number
}

/** The settings pane's edits before Apply: numbers as typed. */
export type TempocDraft = {
  hour5: { isEnabled: boolean; warning: string; danger: string }
  day7: { isEnabled: boolean; warning: string; danger: string }
  utilizationWarning: string
  utilizationDanger: string
}

declare module 'claude-code' {
  interface PluginState {
    tempoc: {
      windows: TempocWindow[]
      view: TempocView
      settings: TempocSettings
      /** The pane's edits since it opened or last applied; null while untouched. */
      draft: TempocDraft | null
      /** True while the person has closed the bars; the status bar offers them back. */
      isHidden: boolean
    }
  }
}

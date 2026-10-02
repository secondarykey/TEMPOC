/** One usage window as the last API response reported it. */
export type TempocWindow = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string
  /** Amount used, 0 to 100. */
  percentUsed: number
  /** When the window resets, epoch milliseconds; null when unknown. */
  resetsAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    tempoc: {
      windows: TempocWindow[]
      /** Epoch milliseconds the elapsed bars are drawn against. */
      now: number
    }
  }
}

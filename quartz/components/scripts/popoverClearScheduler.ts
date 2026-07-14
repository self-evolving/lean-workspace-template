export type PopoverClearSnapshot<TAnchor> = {
  activeAnchor: TAnchor | null
  activeTargetKey: string | null
}

export type PopoverClearSchedulerOptions<TAnchor, TTimeout> = {
  delayMs: number
  getSnapshot: () => PopoverClearSnapshot<TAnchor>
  clearActivePopover: () => void
  setTimeout: (callback: () => void, delayMs: number) => TTimeout
  clearTimeout: (timeout: TTimeout) => void
}

export function createPopoverClearScheduler<TAnchor, TTimeout>({
  delayMs,
  getSnapshot,
  clearActivePopover,
  setTimeout,
  clearTimeout,
}: PopoverClearSchedulerOptions<TAnchor, TTimeout>) {
  let pendingTimeout: TTimeout | null = null

  const cancel = () => {
    if (pendingTimeout === null) return

    clearTimeout(pendingTimeout)
    pendingTimeout = null
  }

  const schedule = () => {
    const scheduledSnapshot = getSnapshot()
    cancel()
    pendingTimeout = setTimeout(() => {
      pendingTimeout = null
      const currentSnapshot = getSnapshot()
      if (
        currentSnapshot.activeAnchor === scheduledSnapshot.activeAnchor &&
        currentSnapshot.activeTargetKey === scheduledSnapshot.activeTargetKey
      ) {
        clearActivePopover()
      }
    }, delayMs)
  }

  return { cancel, schedule }
}

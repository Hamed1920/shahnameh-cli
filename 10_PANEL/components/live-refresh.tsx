'use client'

import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'

const POLL_MS = 2000

interface LiveControl {
  /** Holds back refreshes until the returned release is called. */
  hold: () => () => void
}

const LiveContext = createContext<LiveControl | null>(null)

/**
 * Keeps every page in step with the worker.
 *
 * Polls /api/live for a fingerprint of the files the worker writes and
 * refreshes the route only when it changes, so a finished generation shows up
 * within a couple of seconds. router.refresh() keeps client state -- typed
 * notes, picked uploads, the open candidate -- so this is safe mid-review.
 *
 * Lives in the project layout: one poller per tab, for the project that tab has
 * open. Two tabs on two projects poll their own.
 */
export function LiveRefresh({ project, initialVersion, children }: { project: string; initialVersion: string; children: React.ReactNode }) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const version = useRef(initialVersion)
  const holds = useRef(0)
  const stale = useRef(false)

  const { control, flush } = useMemo(() => {
    const flush = () => {
      if (!stale.current || holds.current > 0) return
      stale.current = false
      routerRef.current.refresh()
    }
    const control: LiveControl = {
      hold() {
        holds.current++
        let released = false
        return () => {
          if (released) return
          released = true
          holds.current--
          flush()
        }
      },
    }
    return { control, flush }
  }, [])

  useEffect(() => {
    let busy = false

    async function check() {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      try {
        const res = await fetch(`/${project}/api/live`, { cache: 'no-store' })
        if (!res.ok) return
        const { version: v } = (await res.json()) as { version: string }
        if (v !== version.current) {
          version.current = v
          stale.current = true
        }
        flush()
      } catch {
        // Dev server restarting or recompiling; the next tick tries again.
      } finally {
        busy = false
      }
    }

    const timer = setInterval(check, POLL_MS)
    // A background tab stops polling; catch up the moment it is looked at.
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flush, project])

  return <LiveContext.Provider value={control}>{children}</LiveContext.Provider>
}

/**
 * While `active`, changes are noted but the page is not refreshed; the refresh
 * happens as soon as it goes false.
 */
export function useHoldLiveRefresh(active: boolean) {
  const live = useContext(LiveContext)
  useEffect(() => {
    if (active && live) return live.hold()
  }, [active, live])
}

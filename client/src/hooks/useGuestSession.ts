import { useCallback, useEffect, useRef, useState } from 'react'
import { request, sessionGone } from '../lib/api'
import { clearSession, deleteExpiredSession, loadSession, parseSession } from '../lib/session'
import type { Session } from '../types/study'

type SessionState =
  | { status: 'loading' | 'error'; session?: never; cleanup?: never }
  | { status: 'expired'; session?: never; cleanup: 'pending' | 'failed' | 'done' }
  | { status: 'ready'; session: Session }

export function useGuestSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const generation = useRef(0)
  const activeSession = useRef<Session | null>(null)
  const expiredId = useRef<string | null>(null)
  const start = useCallback(async (fresh = false) => {
    const current = ++generation.current
    activeSession.current = null
    setState({ status: 'loading' })
    try {
      const session = await loadSession({ fresh })
      if (current === generation.current) {
        activeSession.current = session
        setState({ status: 'ready', session })
      }
    } catch {
      if (current === generation.current) setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    const current = ++generation.current
    let active = true
    loadSession()
      .then((session) => {
        if (active && current === generation.current) {
          activeSession.current = session
          setState({ status: 'ready', session })
        }
      })
      .catch(() => {
        if (active && current === generation.current)
          setState({ status: 'error' })
      })
    return () => {
      active = false
      activeSession.current = null
      generation.current = current + 1
    }
  }, [])

  const finishExpiry = useCallback(async (id: string, current: number) => {
    try {
      await deleteExpiredSession(id)
      if (current !== generation.current) return
      expiredId.current = null
      clearSession()
      setState({ status: 'expired', cleanup: 'done' })
    } catch {
      if (current === generation.current)
        setState({ status: 'expired', cleanup: 'failed' })
    }
  }, [])

  const expire = useCallback(() => {
    const id = activeSession.current?.id ?? expiredId.current
    const current = ++generation.current
    activeSession.current = null
    expiredId.current = id
    if (!id) {
      clearSession()
      setState({ status: 'expired', cleanup: 'done' })
      return
    }
    setState({ status: 'expired', cleanup: 'pending' })
    void finishExpiry(id, current)
  }, [finishExpiry])

  const retryCleanup = useCallback(() => {
    const id = expiredId.current
    if (!id) return
    const current = ++generation.current
    setState({ status: 'expired', cleanup: 'pending' })
    void finishExpiry(id, current)
  }, [finishExpiry])
  useEffect(() => {
    if (state.status !== 'ready') return
    let disposed = false
    let checking = false
    let timeout: number | undefined
    const verify = async () => {
      const latest = activeSession.current
      if (disposed || checking || latest?.id !== state.session.id || Date.now() < latest.expiresAt) return
      checking = true
      const current = generation.current
      try {
        // A successful study action can extend the server session even when its
        // separate activity refresh failed. Confirm expiry with the server.
        const refreshed = parseSession(await request(`/api/sessions/${encodeURIComponent(latest.id)}`))
        if (disposed || current !== generation.current || activeSession.current?.id !== latest.id) return
        const next = activeSession.current.expiresAt > refreshed.expiresAt ? activeSession.current : refreshed
        activeSession.current = next
        setState({ status: 'ready', session: next })
      } catch (error) {
        if (disposed || current !== generation.current || activeSession.current?.id !== latest.id) return
        if (sessionGone(error)) expire()
        else timeout = window.setTimeout(() => void verify(), 10_000)
      } finally { checking = false }
    }
    timeout = window.setTimeout(
      () => void verify(),
      Math.min(2147483647, Math.max(0, state.session.expiresAt - Date.now())),
    )
    const check = () => { void verify() }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      disposed = true
      clearTimeout(timeout)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [state, expire])

  // Call after an upload, concept choice, or recording/submission action succeeds.
  // Rendering, pointer movement, and timers must never extend the session.
  const recordActivity = async (id: string): Promise<Session> => {
    const current = generation.current
    const active = activeSession.current
    if (!active || active.id !== id) {
      throw new Error('Session is no longer active')
    }
    try {
      const session = parseSession(
        await request(`/api/sessions/${encodeURIComponent(id)}/activity`, {
          method: 'PATCH',
        }),
      )
      if (session.id !== id) throw new Error('Unexpected session response')
      if (
        current !== generation.current ||
        activeSession.current?.id !== id
      ) throw new Error('Session is no longer active')
      const next = activeSession.current.expiresAt > session.expiresAt ? activeSession.current : session
      activeSession.current = next
      setState({ status: 'ready', session: next })
      return next
    } catch (error) {
      if (
        current === generation.current &&
        activeSession.current?.id === id &&
        sessionGone(error)
      ) expire()
      throw error
    }
  }
  return {
    ...state,
    retry: () => start(),
    restart: () => {
      if (expiredId.current) return
      return start(true)
    },
    retryCleanup,
    expire,
    recordActivity,
  }
}

export type GuestSessionController = ReturnType<typeof useGuestSession>

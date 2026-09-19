import { useCallback, useEffect, useRef, useState } from 'react'
import { request, sessionGone } from '../lib/api'
import { loadSession, parseSession, saveId, type Session } from '../lib/session'

type SessionState =
  | { status: 'loading' | 'error' | 'expired'; session?: never }
  | { status: 'ready'; session: Session }

export function useGuestSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const generation = useRef(0)
  const start = useCallback(async (fresh = false) => {
    const current = ++generation.current
    if (fresh) saveId(null)
    setState({ status: 'loading' })
    try {
      const session = await loadSession()
      if (current === generation.current) setState({ status: 'ready', session })
    } catch {
      if (current === generation.current) setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    const current = ++generation.current
    let active = true
    loadSession()
      .then((session) => {
        if (active && current === generation.current)
          setState({ status: 'ready', session })
      })
      .catch(() => {
        if (active && current === generation.current)
          setState({ status: 'error' })
      })
    return () => {
      active = false
      generation.current = current + 1
    }
  }, [])

  const expire = useCallback(() => {
    generation.current++
    saveId(null)
    setState({ status: 'expired' })
  }, [])
  useEffect(() => {
    if (state.status !== 'ready') return
    const check = () => {
      if (Date.now() >= state.session.expiresAt) expire()
    }
    const timeout = window.setTimeout(
      check,
      Math.min(2147483647, Math.max(0, state.session.expiresAt - Date.now())),
    )
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [state, expire])

  const recordActivity = async (id: string) => {
    const current = generation.current
    try {
      const session = parseSession(
        await request(`/api/sessions/${encodeURIComponent(id)}/activity`, {
          method: 'PATCH',
        }),
      )
      if (current === generation.current) setState({ status: 'ready', session })
    } catch (error) {
      if (current === generation.current && sessionGone(error)) expire()
      throw error
    }
  }
  return {
    ...state,
    retry: () => start(),
    restart: () => start(true),
    expire,
    recordActivity,
  }
}

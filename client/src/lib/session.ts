import { request, sessionGone } from './api'
import type { Session } from '../types/study'

const key = 'review_recall_session'
let memoryId: string | null = null
let bootstrap: Promise<Session> | null = null
let sessionAttempt = 0

function savedId() {
  try {
    return localStorage.getItem(key) || memoryId
  } catch {
    return memoryId
  }
}

export function saveId(id: string | null) {
  memoryId = id
  try {
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  } catch {
    /* Session can still work in memory. */
  }
}

export function clearSession() {
  sessionAttempt++
  bootstrap = null
  saveId(null)
}

export function parseSession(data: Record<string, unknown>): Session {
  const id = data.session_id ?? data.guest_id
  const expiresAt =
    typeof data.expired_at === 'string' ? Date.parse(data.expired_at) : NaN
  if (
    typeof id !== 'string' ||
    !id ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  )
    throw new Error('Invalid session response')
  return { id, expiresAt }
}

export function loadSession(options: { fresh?: boolean } = {}): Promise<Session> {
  if (options.fresh) clearSession()
  if (bootstrap) return bootstrap
  const attempt = sessionAttempt
  const pending = (async () => {
    const id = savedId()
    if (id) {
      try {
        return parseSession(
          await request(`/api/sessions/${encodeURIComponent(id)}`),
        )
      } catch (error) {
        if (attempt !== sessionAttempt) throw error
        if (!sessionGone(error)) throw error
        saveId(null)
      }
    }
    const session = parseSession(
      await request('/api/sessions', { method: 'POST' }),
    )
    if (attempt === sessionAttempt) saveId(session.id)
    return session
  })()
  bootstrap = pending
  const clearBootstrap = () => {
    if (bootstrap === pending) bootstrap = null
  }
  void pending.then(clearBootstrap, clearBootstrap)
  return pending
}

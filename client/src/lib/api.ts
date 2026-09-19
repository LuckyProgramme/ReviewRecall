const baseUrl = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
).replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  constructor(status: number) {
    super('Request failed')
    this.status = status
  }
}

export async function request(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new ApiError(response.status)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Unexpected response')
  return body as Record<string, unknown>
}

export function sessionGone(error: unknown) {
  return (
    error instanceof ApiError && (error.status === 404 || error.status === 410)
  )
}

import type { ApiErrorKind } from "../types/study"


const baseUrl = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
).replace(/\/$/, '')

export class ApiError extends Error {
  readonly kind: ApiErrorKind = 'http'  
  status: number
  constructor(status: number) {
    super(`Request failed with HTTP ${status}`)
    this.name='ApiError'
    this.status = status
  }
}

export class NetworkError extends Error {
  readonly kind : ApiErrorKind = 'network'  
  
  constructor() {
    super(`Could not reach Network`)
    this.name='NetworkError'
  
  }
}

export class  ResponseError extends Error {
  readonly kind : ApiErrorKind = 'response'  
  
  constructor(message:string) {
    super(message)
    this.name='ResponseError'
  }
}

export async function request(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  let response: Response
  try{
    response=await fetch(`${baseUrl}${path}`,{...options, signal:options.signal ?? AbortSignal.timeout(20000)})
  }
  catch{throw new NetworkError()}

  
  if (!response.ok) throw new ApiError(response.status)
  let body: unknown 
  try{
    body= await response.json()
  } catch { 
    throw new ResponseError('The API returned invalid JSON')
  }

  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ResponseError('Returned an unexpected Response')
  return body as Record<string, unknown>
}

export function sessionGone(error: unknown) {
 
  return (
    error instanceof ApiError && (error.status === 404 || error.status === 410)
  )
}

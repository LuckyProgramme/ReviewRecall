export type Session = { id: string; expiresAt: number }

export type ApiErrorKind= 'http'| 'network' | 'response'
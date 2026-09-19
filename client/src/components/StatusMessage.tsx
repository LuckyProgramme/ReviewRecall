import type { ReactNode } from 'react'

export function StatusMessage({
  children,
  error = false,
  id,
}: {
  children: ReactNode
  error?: boolean
  id?: string
}) {
  return (
    <p
      id={id}
      role={error ? 'alert' : 'status'}
      className={`text-sm leading-relaxed ${error ? 'text-danger' : 'text-muted'}`}
    >
      {children}
    </p>
  )
}

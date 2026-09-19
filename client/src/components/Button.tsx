import type { ButtonHTMLAttributes } from 'react'

const variants = {
  primary:
    'border border-action bg-action text-paper enabled:hover:border-action-hover enabled:hover:bg-action-hover disabled:border-divider disabled:bg-divider disabled:text-muted',
  secondary:
    'border border-control bg-paper text-ink enabled:hover:bg-canvas disabled:text-muted',
  utility:
    'text-muted underline decoration-control underline-offset-4 enabled:hover:text-action',
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
}) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 py-3 text-base font-medium leading-tight transition-colors enabled:cursor-pointer disabled:cursor-not-allowed motion-reduce:transition-none ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

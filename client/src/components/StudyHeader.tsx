import reviewRecallLogo from '../assets/rr.svg'

export function StudyHeader({ current = 0 }: { current?: 0 | 1 | 2 }) {
  const steps = ['Upload', 'Choose', 'Recall']

  return (
    <header className="mx-auto flex w-full max-w-upload flex-col items-center pt-14 sm:pt-20 lg:pt-24">
      <a
        href="/"
        aria-label="Review Recall home"
        className="flex flex-col items-center gap-2 rounded-sm text-ink no-underline"
      >
        <img src={reviewRecallLogo} alt="" className="h-auto w-20" />
        <span className="text-[0.72rem] font-medium tracking-[0.31em] uppercase">
          Review Recall
        </span>
      </a>
      <nav aria-label="Study progress" className="mt-4">
        <ol className="flex items-center text-[0.68rem] font-medium tracking-[0.08em] uppercase">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center">
              {index > 0 && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 10"
                  className="mx-2.5 h-2.5 w-4 text-divider sm:mx-3"
                >
                  <path
                    d="M1 5h12m-3-3 3 3-3 3"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              <span
                aria-current={index === current ? 'step' : undefined}
                className={
                  index === current
                    ? 'inline-flex min-h-7 items-center gap-2 rounded-full bg-action px-3.5 text-paper'
                    : 'text-muted/60'
                }
              >
                {index === current && (
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-paper" />
                )}
                {step}
              </span>
            </li>
          ))}
        </ol>
      </nav>
    </header>
  )
}

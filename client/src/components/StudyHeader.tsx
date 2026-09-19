export function StudyHeader() {
  const steps = ['Upload', 'Choose', 'Recall']

  return (
    <header className="mx-auto flex w-full max-w-upload flex-col items-center pt-14 sm:pt-20 lg:pt-24">
      <a
        href="/"
        aria-label="Review Recall home"
        className="flex items-center gap-3 rounded-sm text-ink no-underline"
      >
        <svg
          aria-hidden="true"
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          className="text-action"
        >
          <circle cx="16" cy="16" r="15" stroke="currentColor" />
          <path
            d="M16 11.5v-2M16 22.5v-2M20.5 16h2M9.5 16h2M19.2 12.8l1.4-1.4M11.4 20.6l1.4-1.4M19.2 19.2l1.4 1.4M11.4 11.4l1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="16" cy="16" r="2.8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
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
                aria-current={index === 0 ? 'step' : undefined}
                className={
                  index === 0
                    ? 'inline-flex min-h-7 items-center gap-2 rounded-full bg-action px-3.5 text-paper'
                    : 'text-muted/60'
                }
              >
                {index === 0 && (
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

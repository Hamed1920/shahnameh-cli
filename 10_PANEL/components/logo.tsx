/**
 * The mark: a frame of film, sprockets down both edges, with the picture cut
 * out of it as a play triangle. One colour (currentColor), so it works on any
 * background and matches the favicon in app/icon.svg.
 */
export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="currentColor"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="5" y="6.5" width="3" height="3" rx="1" />
      <rect x="5" y="12" width="3" height="3" rx="1" />
      <rect x="5" y="17.5" width="3" height="3" rx="1" />
      <rect x="5" y="23" width="3" height="3" rx="1" />
      <rect x="24" y="6.5" width="3" height="3" rx="1" />
      <rect x="24" y="12" width="3" height="3" rx="1" />
      <rect x="24" y="17.5" width="3" height="3" rx="1" />
      <rect x="24" y="23" width="3" height="3" rx="1" />
      <path
        fillRule="evenodd"
        d="M10.5 6.5h11a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Zm2.9 4.7v9.6a.8.8 0 0 0 1.22.68l7.1-4.8a.8.8 0 0 0 0-1.36l-7.1-4.8a.8.8 0 0 0-1.22.68Z"
      />
    </svg>
  )
}

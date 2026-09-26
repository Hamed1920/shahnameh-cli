/**
 * Shown the moment a page is clicked, while the server reads the project's files.
 * Lives inside the project layout, so the sidebar stays put and only the page
 * area changes. A live refresh never shows it: that keeps the page on screen.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="border-b border-edge pb-9">
        <div className="h-3 w-28 rounded bg-white/[0.06]" />
        <div className="mt-5 h-12 w-72 max-w-full rounded-md bg-white/[0.07]" />
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-xl border border-edge bg-panel p-3">
            <div className="aspect-video rounded-lg bg-white/[0.04]" />
            <div className="mt-3 h-3 w-2/3 rounded bg-white/[0.06]" />
            <div className="mt-2 h-3 w-1/3 rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
    </div>
  )
}

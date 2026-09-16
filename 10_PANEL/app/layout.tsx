import type { Metadata } from 'next'
import { Geist, Geist_Mono, Instrument_Serif, Vazirmatn } from 'next/font/google'
import { cookies } from 'next/headers'
import { LiveRefresh } from '@/components/live-refresh'
import { MotionProvider } from '@/components/motion-provider'
import { SIDEBAR_COOKIE } from '@/components/nav-items'
import { Sidebar } from '@/components/sidebar'
import { getProjectVersion } from '@/lib/live'
import { getWaitingJobs } from '@/lib/store'
import { cn } from '@/lib/cn'
import './globals.css'

/* Three voices: Geist for the interface, Geist Mono for every ID and number
   that has to line up, Instrument Serif for titles. Vazirmatn only supplies
   Arabic-script glyphs, so it is not preloaded -- the browser fetches it the
   first time a Farsi note is on screen. */
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const instrument = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-instrument' })
const vazir = Vazirmatn({ subsets: ['arabic'], variable: '--font-vazir', preload: false })

export const metadata: Metadata = {
  title: 'Shahnameh Review Panel',
  description: 'Review, accept and deny Higgsfield outputs for the Shahnameh project.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === '1'
  // Taken with the render, so a change between render and mount is not missed.
  // queue.jsonl and state.json are both in the version, so the badge moves with every live refresh.
  const [version, waiting] = await Promise.all([getProjectVersion(), getWaitingJobs()])

  return (
    <html lang="en" className={cn(geist.variable, geistMono.variable, instrument.variable, vazir.variable)}>
      {/*
        Fixed-viewport shell: the document never scrolls, <main> is the only
        scroller, and `scroll-pane` reserves its scrollbar gutter permanently.
        That is what stops the centred content jumping sideways when a page
        grows tall enough to need a scrollbar, or when a review card expands.

        The content padding here is mirrored by <StickyHeader> (components/ui/
        text.tsx), which bleeds back out to the edges. Change both together.
      */}
      <body className="relative isolate flex h-dvh overflow-hidden antialiased">
        <MotionProvider>
          <LiveRefresh initialVersion={version}>
            <Sidebar defaultCollapsed={collapsed} counts={{ '/queue': waiting.length }} />
            <main className="scroll-pane flex-1">
              <div className="mx-auto max-w-[1600px] px-6 pt-10 pb-24 lg:px-12">{children}</div>
            </main>
          </LiveRefresh>
        </MotionProvider>
      </body>
    </html>
  )
}

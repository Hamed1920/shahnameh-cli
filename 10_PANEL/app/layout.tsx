import type { Metadata } from 'next'
import { Geist, Geist_Mono, Instrument_Serif, Vazirmatn } from 'next/font/google'
import { MotionProvider } from '@/components/motion-provider'
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
  title: 'Film Making for Dummies',
  description: 'Run a film from prompt to finished shot: references, prompts, generation, review.',
}

/**
 * The shell every page shares. The sidebar, the live refresh and everything
 * else that belongs to one film live in app/[project]/layout.tsx; this level
 * is the project picker, which belongs to no project.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(geist.variable, geistMono.variable, instrument.variable, vazir.variable)}>
      {/*
        Fixed-viewport shell: the document never scrolls, the page's own
        scroller is the only one, and `scroll-pane` reserves its scrollbar
        gutter permanently. That is what stops the centred content jumping
        sideways when a page grows tall enough to need a scrollbar.
      */}
      <body className="relative isolate flex h-dvh overflow-hidden antialiased">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}

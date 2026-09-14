import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { MotionProvider } from '@/components/motion-provider'
import { SIDEBAR_COOKIE } from '@/components/nav-items'
import { Sidebar } from '@/components/sidebar'
import './globals.css'

export const metadata: Metadata = {
  title: 'Shahnameh Review Panel',
  description: 'Review, accept and deny Higgsfield outputs for the Shahnameh project.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === '1'

  return (
    <html lang="en">
      {/*
        Fixed-viewport shell: the document never scrolls, <main> is the only
        scroller, and `scroll-pane` reserves its scrollbar gutter permanently.
        That is what stops the centred content jumping sideways when a page
        grows tall enough to need a scrollbar, or when a review card expands.
      */}
      <body className="flex h-dvh overflow-hidden antialiased">
        <MotionProvider>
          <Sidebar defaultCollapsed={collapsed} />
          <main className="scroll-pane flex-1">
            <div className="mx-auto max-w-[1600px] px-8 pt-8 pb-16">{children}</div>
          </main>
        </MotionProvider>
      </body>
    </html>
  )
}

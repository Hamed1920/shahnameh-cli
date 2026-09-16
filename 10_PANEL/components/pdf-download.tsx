'use client'

import { useState } from 'react'
import { ExternalLink, FileDown, LoaderCircle } from 'lucide-react'
import { buttonClasses, type TONES } from '@/components/ui/button-styles'

/**
 * Downloads a generated PDF from the panel.
 *
 * The PDF is fetched as JSON (base64) and saved from a blob made in the page.
 * A plain link or a fetch of the PDF itself does not survive a download
 * manager: Internet Download Manager grabs any response that looks like a
 * PDF, cancels the browser's request (the page sees an empty 204) and saves
 * its own copy as `index-pdf.txt`. It does not touch JSON or blob URLs.
 *
 * A server error is shown as a message, never saved as a file, and the build
 * time (a few seconds the first time) shows as progress.
 */
export function PdfDownload({ href, label, tone = 'outline' }: { href: string; label: string; tone?: keyof typeof TONES }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchPdf(): Promise<{ name: string; url: string }> {
    const res = await fetch(`${href}${href.includes('?') ? '&' : '?'}format=json`, { cache: 'no-store' })
    const text = await res.text()
    let body: { name?: string; data?: string } | null = null
    try { body = JSON.parse(text) } catch { /* not JSON: an error page or plain message */ }
    if (!res.ok || !body?.data) {
      const msg = text.trim()
      throw new Error(msg && msg.length < 300 && !body ? msg : `The server answered ${res.status} instead of the PDF.`)
    }
    const raw = atob(body.data)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return { name: body.name ?? 'Shahnameh.pdf', url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })) }
  }

  async function run(open: boolean) {
    setBusy(true)
    setError(null)
    // Opened now, filled in later: a tab opened after an await is treated as a popup and blocked.
    const tab = open ? window.open('', '_blank') : null
    try {
      const { name, url } = await fetchPdf()
      if (tab) tab.location.href = url
      else {
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      // Revoked later, not now: the browser may still be reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
    } catch (e) {
      tab?.close()
      setError((e as Error).message || 'Could not download the PDF.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button type="button" onClick={() => run(false)} disabled={busy} className={buttonClasses({ tone, size: 'md' })}>
        {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <FileDown aria-hidden className="size-4" />}
        {busy ? 'Building…' : label}
      </button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs leading-relaxed text-bad">
          {error}{' '}
          <button type="button" onClick={() => run(true)} className="inline-flex cursor-pointer items-center gap-1 text-muted underline hover:text-fg">
            Open it in a tab <ExternalLink aria-hidden className="size-3" />
          </button>
        </p>
      )}
    </div>
  )
}

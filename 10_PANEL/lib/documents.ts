import { unzipSync } from 'fflate'
import { docxXmlToText } from './documents-xml'

/**
 * Text out of the documents Hamed drops on the Prompts page. Server-only:
 * .docx is a zip and .pdf needs pdf.js, neither of which belongs in the page
 * bundle. Plain text files are read in the browser and never come here.
 *
 * Nothing here parses prompts; it only produces the text that
 * lib/prompt-parser.ts then splits, so a docx and a paste behave the same.
 */

export { DOCUMENT_EXT, MAX_DOCUMENTS, MAX_DOCUMENT_BYTES } from './document-types'

export function docxToText(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const xml = files['word/document.xml']
  if (!xml) throw new Error('not a Word document (no word/document.xml inside)')
  return docxXmlToText(new TextDecoder('utf-8').decode(xml))
}

/**
 * pdf.js text extraction. Items are grouped into lines by their vertical
 * position. Persian PDFs often come out in visual order or with glyphs split;
 * the page shows the extracted text before parsing so that is visible, and
 * asks for .docx where possible.
 */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false })
  const doc = await task.promise
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const lines: { y: number; parts: { x: number; s: string }[] }[] = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      const [, , , , x, y] = item.transform as number[]
      const line = lines.find((l) => Math.abs(l.y - y) < 2.5)
      if (line) line.parts.push({ x, s: item.str })
      else lines.push({ y, parts: [{ x, s: item.str }] })
    }
    lines.sort((a, b) => b.y - a.y)
    pages.push(lines.map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join('')).join('\n'))
    page.cleanup()
  }
  await task.destroy()
  return pages.join('\n\n')
}

export async function documentToText(name: string, bytes: Uint8Array): Promise<string> {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  if (ext === '.docx') return docxToText(bytes)
  if (ext === '.pdf') return pdfToText(bytes)
  return new TextDecoder('utf-8').decode(bytes)
}

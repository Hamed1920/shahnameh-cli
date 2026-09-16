import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'

/**
 * A top-to-bottom PDF writer: headings, wrapped paragraphs, bullets, code
 * lines and image grids, with page breaks handled. Standard fonts only, so no
 * font files ship with the panel; they cover Latin text, which is all the
 * registries hold (they are ASCII by rule). Anything a font cannot draw --
 * Persian in an old prompt -- is replaced rather than crashing the export.
 */

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = { x: 50, top: 56, bottom: 60 }

export const INK = rgb(0.09, 0.09, 0.09)
export const MUTED = rgb(0.38, 0.38, 0.38)
export const FAINT = rgb(0.58, 0.58, 0.58)
const RULE = rgb(0.86, 0.86, 0.86)
const CODE_BG = rgb(0.955, 0.955, 0.955)

type Face = 'sans' | 'bold' | 'mono'

export interface Cell {
  jpg: Buffer | null
  /** First line is drawn in mono (the token), the rest in sans. */
  caption: string[]
}

export class PdfWriter {
  readonly pdf: PDFDocument
  private fonts!: Record<Face, PDFFont>
  private page!: PDFPage
  private y = 0
  private drawable = new Map<string, boolean>()
  readonly width = A4.w - MARGIN.x * 2

  private constructor(pdf: PDFDocument) { this.pdf = pdf }

  static async create(title: string): Promise<PdfWriter> {
    const pdf = await PDFDocument.create()
    pdf.setTitle(title)
    pdf.setCreator('Shahnameh review panel')
    const w = new PdfWriter(pdf)
    w.fonts = {
      sans: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      mono: await pdf.embedFont(StandardFonts.Courier),
    }
    w.newPage()
    return w
  }

  newPage() {
    this.page = this.pdf.addPage([A4.w, A4.h])
    this.y = A4.h - MARGIN.top
  }

  /** Start a new page unless `height` still fits on this one. */
  ensure(height: number) {
    if (this.y - height < MARGIN.bottom) this.newPage()
  }

  space(h: number) { this.y -= h }

  /** Replace characters the standard fonts cannot encode. Mostly-unencodable text becomes a note. */
  clean(s: string, face: Face = 'sans'): string {
    const font = this.fonts[face]
    let bad = 0
    const out = [...String(s ?? '').replace(/\r/g, '').replace(/\t/g, '  ')].map((ch) => {
      if (ch === '\n') return ch
      const key = `${face}|${ch}`
      if (!this.drawable.has(key)) {
        try { font.encodeText(ch); this.drawable.set(key, true) } catch { this.drawable.set(key, false) }
      }
      if (this.drawable.get(key)) return ch
      bad++
      return /\s/.test(ch) ? ' ' : '?'
    }).join('')
    return bad > 0 && bad / Math.max(1, out.length) > 0.3 ? '[text in a script this PDF cannot show]' : out
  }

  private wrap(text: string, face: Face, size: number, width: number): string[] {
    const font = this.fonts[face]
    const lines: string[] = []
    for (const para of this.clean(text, face).split('\n')) {
      let line = ''
      for (const word of para.split(/ +/)) {
        const tryLine = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(tryLine, size) <= width) { line = tryLine; continue }
        if (line) lines.push(line)
        // A single word wider than the column (a long id) is broken by characters.
        let rest = word
        while (font.widthOfTextAtSize(rest, size) > width) {
          let n = rest.length
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--
          lines.push(rest.slice(0, n))
          rest = rest.slice(n)
        }
        line = rest
      }
      lines.push(line)
    }
    return lines
  }

  text(
    text: string,
    { face = 'sans', size = 10, color = INK, indent = 0, lead = 1.45, after = 6, keep = false }:
      { face?: Face; size?: number; color?: RGB; indent?: number; lead?: number; after?: number; keep?: boolean } = {},
  ) {
    const lines = this.wrap(text, face, size, this.width - indent)
    const lh = size * lead
    if (keep) this.ensure(lines.length * lh)
    for (const line of lines) {
      this.ensure(lh)
      this.page.drawText(line, { x: MARGIN.x + indent, y: this.y - size, size, font: this.fonts[face], color })
      this.y -= lh
    }
    this.y -= after
  }

  title(text: string, sub: string) {
    this.text(text, { face: 'bold', size: 24, lead: 1.2, after: 4 })
    this.text(sub, { size: 10, color: MUTED, after: 14 })
    this.rule(16)
  }

  heading(text: string, level: 1 | 2 = 1) {
    const size = level === 1 ? 16 : 12
    this.ensure(size * 4)
    this.space(level === 1 ? 10 : 6)
    this.text(text, { face: 'bold', size, lead: 1.25, after: level === 1 ? 8 : 5 })
  }

  bullets(items: string[], { size = 10 }: { size?: number } = {}) {
    for (const item of items) {
      const lines = this.wrap(item, 'sans', size, this.width - 14)
      const lh = size * 1.45
      this.ensure(lh)
      this.page.drawText('-', { x: MARGIN.x + 3, y: this.y - size, size, font: this.fonts.sans, color: MUTED })
      for (const [i, line] of lines.entries()) {
        if (i > 0) this.ensure(lh)
        this.page.drawText(line, { x: MARGIN.x + 14, y: this.y - size, size, font: this.fonts.sans, color: INK })
        this.y -= lh
      }
      this.y -= 2
    }
    this.y -= 4
  }

  /** Monospaced lines on a light band, kept on one page when they fit on one. */
  code(lines: string[], size = 8.5) {
    const wrapped = lines.flatMap((l) => (l === '' ? [''] : this.wrap(l, 'mono', size, this.width - 20)))
    const lh = size * 1.5
    const block = wrapped.length * lh + 16
    if (block < A4.h - MARGIN.top - MARGIN.bottom) this.ensure(block)
    let i = 0
    while (i < wrapped.length) {
      this.ensure(lh + 16)
      const fit = Math.max(1, Math.min(wrapped.length - i, Math.floor((this.y - MARGIN.bottom - 16) / lh)))
      const h = fit * lh + 16
      this.page.drawRectangle({ x: MARGIN.x, y: this.y - h, width: this.width, height: h, color: CODE_BG })
      let y = this.y - 8
      for (const line of wrapped.slice(i, i + fit)) {
        this.page.drawText(line, { x: MARGIN.x + 10, y: y - size, size, font: this.fonts.mono, color: INK })
        y -= lh
      }
      this.y -= h
      i += fit
    }
    this.y -= 10
  }

  rule(after = 12) {
    this.ensure(2)
    this.page.drawLine({ start: { x: MARGIN.x, y: this.y }, end: { x: MARGIN.x + this.width, y: this.y }, thickness: 0.6, color: RULE })
    this.y -= after
  }

  /** Images in a grid of `cols`, each fitted into a square with its caption below. Rows never split across pages. */
  async grid(cells: Cell[], cols = 4) {
    const gap = 12
    const cw = (this.width - gap * (cols - 1)) / cols
    for (let r = 0; r < cells.length; r += cols) {
      const row = cells.slice(r, r + cols)
      const captions = row.map((c) => c.caption.map((line, i) => this.wrap(line, i === 0 ? 'mono' : 'sans', i === 0 ? 7.5 : 7, cw)))
      const capH = Math.max(...captions.map((c) => c.reduce((n, l) => n + l.length, 0))) * 9.5
      const h = cw + 6 + capH + 12
      this.ensure(h)
      for (const [i, cell] of row.entries()) {
        const x = MARGIN.x + i * (cw + gap)
        const top = this.y
        this.page.drawRectangle({ x, y: top - cw, width: cw, height: cw, color: CODE_BG })
        if (cell.jpg) {
          try {
            const img = await this.pdf.embedJpg(cell.jpg)
            const s = Math.min(cw / img.width, cw / img.height)
            const w = img.width * s
            const ih = img.height * s
            this.page.drawImage(img, { x: x + (cw - w) / 2, y: top - cw + (cw - ih) / 2, width: w, height: ih })
          } catch { /* unreadable image: the empty square stays */ }
        } else {
          this.page.drawText('no image', { x: x + cw / 2 - 16, y: top - cw / 2 - 3, size: 7, font: this.fonts.sans, color: FAINT })
        }
        let y = top - cw - 6
        for (const [j, lines] of captions[i].entries()) {
          for (const line of lines) {
            this.page.drawText(line, { x, y: y - 7.5, size: j === 0 ? 7.5 : 7, font: this.fonts[j === 0 ? 'mono' : 'sans'], color: j === 0 ? INK : MUTED })
            y -= 9.5
          }
        }
      }
      this.y -= h
    }
  }

  async finish(footer: string): Promise<Uint8Array> {
    const pages = this.pdf.getPages()
    for (const [i, p] of pages.entries()) {
      const label = this.clean(`${footer}  -  page ${i + 1} of ${pages.length}`)
      p.drawText(label, { x: MARGIN.x, y: 30, size: 7.5, font: this.fonts.sans, color: FAINT })
    }
    return this.pdf.save()
  }
}

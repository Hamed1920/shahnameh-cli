/**
 * word/document.xml -> plain text. Pure, so it is unit-tested; the unzip that
 * feeds it lives in documents.ts. This is the run-prompts skill's recipe:
 * paragraph ends and breaks become newlines, tabs stay tabs, every other tag
 * is dropped, entities are decoded. Persian text, ZWNJ included, passes
 * through untouched.
 */
export function docxXmlToText(xml: string): string {
  let t = String(xml ?? '')
  t = t.replace(/<w:tab\s*\/>/g, '\t')
  t = t.replace(/<w:(?:br|cr)\s*\/>/g, '\n')
  t = t.replace(/<\/w:p>/g, '\n')
  t = t.replace(/<w:p\s*\/>/g, '\n')
  t = t.replace(/<[^>]+>/g, '')
  t = t
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return t.replace(/\n$/, '')
}

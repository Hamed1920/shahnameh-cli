/**
 * Where a character of a <textarea> is on the screen.
 *
 * A textarea will not say. The usual way is to lay the same text out in an
 * off-screen copy that has the textarea's font, width and padding, put a marker
 * where the character is, and read the marker's position. Used to hang a small
 * popup at the "@" someone just typed.
 */
const COPIED = [
  'direction', 'boxSizing', 'width', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily',
  'lineHeight', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize',
] as const

export interface CaretBox {
  /** Viewport pixels: the left edge of the character, and the top and bottom of its line. */
  left: number
  top: number
  bottom: number
}

export function caretBox(el: HTMLTextAreaElement, index: number): CaretBox {
  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  const s = mirror.style
  for (const prop of COPIED) s[prop as never] = style[prop as never]
  s.position = 'absolute'
  s.visibility = 'hidden'
  s.top = '0'
  s.left = '-9999px'
  s.whiteSpace = 'pre-wrap'
  s.overflowWrap = 'break-word'
  s.height = 'auto'
  mirror.textContent = el.value.slice(0, index)
  const marker = document.createElement('span')
  // Something to measure even at the end of the text or on an empty line.
  marker.textContent = el.value.slice(index, index + 1) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const box = el.getBoundingClientRect()
  const line = marker.offsetHeight || parseFloat(style.lineHeight) || 18
  const out = {
    left: box.left + el.clientLeft + marker.offsetLeft - el.scrollLeft,
    top: box.top + el.clientTop + marker.offsetTop - el.scrollTop,
    bottom: 0,
  }
  out.bottom = out.top + line
  document.body.removeChild(mirror)
  // A caret scrolled out of view of the box still has to land somewhere on screen.
  out.top = Math.min(Math.max(out.top, box.top), box.bottom - line)
  out.bottom = out.top + line
  return out
}

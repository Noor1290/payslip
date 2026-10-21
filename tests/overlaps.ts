// The overlap check of the long-name tests (drawings 2 and 4): every pair of things on a drawn page that touch.
import { FONT_METRICS, measureText, type DrawList } from '../src/writers/pageGeometry'

/** Every pair of things on the page that touch: two texts, or a text and a line. Empty when nothing overlaps. */
export function overlaps(page: DrawList): string[] {
  const boxes = page.texts.map((t) => {
    const { ascent, descent, unitsPerEm } = FONT_METRICS[t.font] as unknown as { ascent: number; descent: number; unitsPerEm: number }
    const width = measureText(t.text, t.font, t.size).width
    return { name: t.text, x1: t.x, x2: t.x + width, y1: t.y - (ascent * t.size) / unitsPerEm, y2: t.y - (descent * t.size) / unitsPerEm }
  })
  const found: string[] = []
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1)) {
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) found.push(`"${a.name}" and "${b.name}"`)
    }
    for (const line of page.lines) {
      const half = line.width / 2
      const lx1 = Math.min(line.x1, line.x2) - half
      const lx2 = Math.max(line.x1, line.x2) + half
      const ly1 = Math.min(line.y1, line.y2) - half
      const ly2 = Math.max(line.y1, line.y2) + half
      if (a.x1 < lx2 && lx1 < a.x2 && a.y1 < ly2 && ly1 < a.y2) found.push(`"${a.name}" and a line at ${line.x1},${line.y1}`)
    }
  })
  return found
}

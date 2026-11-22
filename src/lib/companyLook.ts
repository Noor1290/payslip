// How a company looks on a card: the same initials and colour as in the dashboard's company
// picker (payroll_hub src/features/companyLists/pickerModel.ts). Keep the two the same.

/** "AB" from "ABC Co Ltd", "BL" from "Blue Lagoon Ltd": Co, Ltd and the like are left out. */
export function initialsOf(name: string): string {
  const skip = new Set(['co', 'ltd', 'limited', 'the', 'and', '&', 'of', 'plc', 'inc'])
  const words = name
    .replace(/[().,]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !skip.has(word.toLowerCase()))
  const kept = words.length > 0 ? words : [name.trim()]
  const letters =
    kept.length === 1
      ? [...kept[0]].slice(0, 2).join('')
      : kept
          .slice(0, 2)
          .map((word) => [...word][0] ?? '')
          .join('')
  return letters.toUpperCase() || '?'
}

/** One of eight hues, the same every time for the same company (its BRN, or its id). */
export function hueOf(key: string): number {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return [162, 200, 230, 262, 300, 340, 30, 75][hash % 8]
}

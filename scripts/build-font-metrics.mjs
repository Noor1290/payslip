// Writes src/assets/fonts/metrics.json: the advance width of every character in the two bundled
// payslip fonts. The preview and the PDF place text from this one table, so they cannot drift.
// Run again only if the font files change: node scripts/build-font-metrics.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fontkit from '@pdf-lib/fontkit'

const fontsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/fonts')

export function readMetrics(file) {
  const font = fontkit.create(readFileSync(resolve(fontsDir, file)))
  const widths = {}
  for (const codePoint of [...font.characterSet].sort((a, b) => a - b)) {
    widths[codePoint] = font.glyphForCodePoint(codePoint).advanceWidth
  }
  return {
    postscriptName: font.postscriptName,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    capHeight: font.capHeight,
    widths,
  }
}

export function buildMetrics() {
  return {
    regular: readMetrics('texgyrepagella-regular.otf'),
    bold: readMetrics('texgyrepagella-bold.otf'),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metrics = buildMetrics()
  writeFileSync(resolve(fontsDir, 'metrics.json'), `${JSON.stringify(metrics)}\n`)
  for (const [name, m] of Object.entries(metrics)) {
    console.log(name, m.postscriptName, 'unitsPerEm', m.unitsPerEm, 'capHeight', m.capHeight, 'characters', Object.keys(m.widths).length)
  }
}

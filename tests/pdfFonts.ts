import fontkit from '@pdf-lib/fontkit'
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib'
import { cffTableOf, glyphWidth, readCffStrict, type CffFont } from './cff'

// Reads the fonts of a generated PDF and how its text is drawn with them, from the PDF's own
// objects (not through pdf.js, which forgives a font program other viewers refuse), and checks
// them against the bundled font files.

export interface FontEntry {
  /** BaseFont, without the random number pdf-lib adds after it. */
  name: string
  /** For example "Type0 / CIDFontType0". */
  kind: string
  descendant: PDFDict
  /** The embedded font program, or null when the font is only named. */
  program: Uint8Array | null
  programKind: string | null
  programRef: PDFRef | null
  /** Advance of each glyph code, in 1/1000 of the text size, as the PDF states it. */
  widths: Map<number, number>
  /** The character each glyph code stands for, from the PDF's ToUnicode table. */
  unicode: Map<number, string>
}
export interface TextRun {
  font: FontEntry
  size: number
  x: number
  y: number
  glyphs: number[]
  /** The run read back through the ToUnicode table. */
  text: string
}
export interface PdfFonts {
  pdf: PDFDocument
  fonts: FontEntry[]
  runs: TextRun[]
  /** Anything other than "set the font, set a plain position, show one whole string": TJ, Tc, Tw, Tz, a scaled text matrix... */
  otherTextOperators: string[]
}

/** Stands for a glyph code the PDF gives no character for (the Unicode replacement character). */
const UNKNOWN_GLYPH = String.fromCharCode(0xfffd)

const name = (text: string) => PDFName.of(text)
const streamText = (stream: PDFStream) =>
  stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1') : ''

function readWidths(descendant: PDFDict): Map<number, number> {
  const widths = new Map<number, number>()
  const w = descendant.lookupMaybe(name('W'), PDFArray)
  if (!w) return widths
  let at = 0
  while (at < w.size()) {
    const first = w.lookup(at, PDFNumber).asNumber()
    const next = w.lookup(at + 1)
    if (next instanceof PDFArray) {
      for (let index = 0; index < next.size(); index++) widths.set(first + index, next.lookup(index, PDFNumber).asNumber())
      at += 2
    } else {
      const last = w.lookup(at + 1, PDFNumber).asNumber()
      const width = w.lookup(at + 2, PDFNumber).asNumber()
      for (let code = first; code <= last; code++) widths.set(code, width)
      at += 3
    }
  }
  return widths
}

function readUnicode(font: PDFDict): Map<number, string> {
  const unicode = new Map<number, string>()
  const stream = font.lookupMaybe(name('ToUnicode'), PDFStream)
  if (!stream) return unicode
  for (const block of streamText(stream).matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, value] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const units = value.match(/.{4}/g)!.map((unit) => parseInt(unit, 16))
      unicode.set(parseInt(code, 16), String.fromCharCode(...units))
    }
  }
  return unicode
}

export async function readPdfFonts(bytes: Uint8Array): Promise<PdfFonts> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const page = pdf.getPage(0).node
  const fontDict = page.Resources()!.lookup(name('Font'), PDFDict)

  // pdf-lib gives every drawn text its own resource name; they point at a few font objects.
  const byRef = new Map<string, FontEntry>()
  const byKey = new Map<string, FontEntry>()
  for (const [key, value] of fontDict.entries()) {
    const id = value.toString()
    let entry = byRef.get(id)
    if (!entry) {
      const font = pdf.context.lookup(value, PDFDict)
      const descendants = font.lookupMaybe(name('DescendantFonts'), PDFArray)
      const descendant = descendants ? descendants.lookup(0, PDFDict) : font
      const descriptor = descendant.lookupMaybe(name('FontDescriptor'), PDFDict)
      let program: Uint8Array | null = null
      let programKind: string | null = null
      let programRef: PDFRef | null = null
      for (const fileKey of ['FontFile', 'FontFile2', 'FontFile3']) {
        const ref = descriptor?.get(name(fileKey))
        const stream = descriptor?.lookupMaybe(name(fileKey), PDFStream)
        if (!(ref instanceof PDFRef) || !(stream instanceof PDFRawStream)) continue
        program = decodePDFRawStream(stream).decode()
        programKind = stream.dict.lookupMaybe(name('Subtype'), PDFName)?.decodeText() ?? fileKey
        programRef = ref
      }
      entry = {
        name: font.lookup(name('BaseFont'), PDFName).decodeText().replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, ''),
        kind: [font, descendant].filter((dict, index) => index === 0 || dict !== font).map((dict) => dict.lookup(name('Subtype'), PDFName).decodeText()).join(' / '),
        descendant,
        program,
        programKind,
        programRef,
        widths: readWidths(descendant),
        unicode: readUnicode(font),
      }
      byRef.set(id, entry)
    }
    byKey.set(key.decodeText(), entry)
  }

  const contents = page.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref, PDFStream)) : contents ? [contents] : []
  const runs: TextRun[] = []
  const otherTextOperators: string[] = []
  let font: FontEntry | undefined
  let size = 0
  let position: [number, number] | null = null
  for (const raw of streams.map(streamText).join('\n').split('\n')) {
    const line = raw.trim()
    const setFont = /^\/(\S+)\s+([\d.]+)\s+Tf$/.exec(line)
    const setMatrix = /^(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) Tm$/.exec(line)
    const show = /^<([0-9A-Fa-f]*)>\s*Tj$/.exec(line)
    if (setFont) {
      font = byKey.get(setFont[1])
      size = Number(setFont[2])
    } else if (setMatrix) {
      if (setMatrix.slice(1, 5).join(' ') !== '1 0 0 1') otherTextOperators.push(line)
      position = [Number(setMatrix[5]), Number(setMatrix[6])]
    } else if (show) {
      if (!font || !position) throw new Error(`Text is shown before its font and position are set: ${line}`)
      const glyphs = (show[1].match(/.{4}/g) ?? []).map((code) => parseInt(code, 16))
      const entry = font
      runs.push({ font, size, x: position[0], y: position[1], glyphs, text: glyphs.map((code) => entry.unicode.get(code) ?? UNKNOWN_GLYPH).join('') })
    } else if (/(^|\s)(TJ|Tc|Tw|Tz|Ts|Tr|Td|TD|'|")$/.test(line)) {
      otherTextOperators.push(line)
    }
  }
  return { pdf, fonts: [...byRef.values()].sort((a, b) => a.name.localeCompare(b.name)), runs, otherTextOperators }
}

/** Width of a run as the PDF draws it: the sum of its glyph advances, in points. */
export function runWidth(run: TextRun): number {
  return run.glyphs.reduce((sum, code) => sum + (run.font.widths.get(code) ?? Number.NaN), 0) * (run.size / 1000)
}

/** What the recordings keep about each font of a PDF. */
export function fontRecord(font: FontEntry) {
  let glyphs: number | null = null
  try {
    if (font.program) glyphs = readCffStrict(font.program).charStrings.length
  } catch {
    // A font program a strict viewer refuses has no glyphs to count.
  }
  return {
    name: font.name,
    kind: font.kind,
    embedded: font.program !== null,
    program: font.programKind,
    header: font.program ? Buffer.from(font.program.subarray(0, 4)).toString('hex') : null,
    glyphs,
  }
}

/** Largest accepted difference between two advances of the same glyph, in 1/1000 of the text size. */
export const ADVANCE_TOLERANCE = 0.5

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index])

/**
 * Everything wrong with the fonts of a PDF, as sentences; empty when all is well. Each font must
 * be embedded in a form a strict viewer loads, must be one of the bundled fonts (same name, same
 * glyph programs), and every glyph drawn must advance by that font's own width.
 */
export function fontProblems(pdf: PdfFonts, bundledFiles: readonly Uint8Array[]): string[] {
  const bundled = bundledFiles.map((bytes) => {
    const font = fontkit.create(bytes)
    return { font, name: font.postscriptName, cff: readCffStrict(cffTableOf(bytes)) }
  })
  const problems = new Set<string>()
  const read = new Map<FontEntry, { cff: CffFont; source: (typeof bundled)[number] }>()

  for (const font of pdf.fonts) {
    if (!font.program) {
      problems.add(`${font.name} is not embedded in the PDF`)
      continue
    }
    let cff: CffFont
    try {
      cff = readCffStrict(font.program)
    } catch (error) {
      problems.add(`${font.name}: a strict viewer refuses the embedded font program and draws another font. ${(error as Error).message}`)
      continue
    }
    const source = bundled.find((candidate) => candidate.name === font.name && candidate.name === cff.name)
    if (!source) {
      problems.add(`${font.name} (font program "${cff.name}") is not one of the bundled fonts`)
      continue
    }
    if (cff.nominalWidthX !== source.cff.nominalWidthX || cff.defaultWidthX !== source.cff.defaultWidthX) {
      problems.add(`${font.name}: the embedded font program has other default widths than the bundled font`)
    }
    // A subset keeps a glyph subroutine as it is, or empties it to a lone "return" (byte 11).
    const subrsKept =
      cff.localSubrs.length === source.cff.localSubrs.length &&
      cff.localSubrs.every((subr, index) => sameBytes(subr, source.cff.localSubrs[index]) || (subr.length === 1 && subr[0] === 11))
    if (!subrsKept) problems.add(`${font.name}: the glyph subroutines are not those of the bundled font`)
    read.set(font, { cff, source })
  }

  for (const run of pdf.runs) {
    const known = read.get(run.font)
    if (!known) continue
    const { cff, source } = known
    for (const code of run.glyphs) {
      const char = run.font.unicode.get(code)
      const glyph = cff.cids ? cff.cids.indexOf(code) : code
      if (char === undefined || glyph < 0 || glyph >= cff.charStrings.length) {
        problems.add(`${run.font.name}: glyph code ${code} in "${run.text}" has no character or no glyph`)
        continue
      }
      const sourceGlyph = source.font.glyphForCodePoint(char.codePointAt(0)!)
      if (!sameBytes(cff.charStrings[glyph], source.cff.charStrings[sourceGlyph.id])) {
        problems.add(`${run.font.name}: the glyph drawn for "${char}" is not the bundled font's glyph`)
      }
      const own = (sourceGlyph.advanceWidth * 1000) / source.font.unitsPerEm
      const stated = run.font.widths.get(code)
      const inProgram = glyphWidth(cff, glyph)
      if (stated === undefined || Math.abs(stated - own) > ADVANCE_TOLERANCE || Math.abs(inProgram - own) > ADVANCE_TOLERANCE) {
        problems.add(`${run.font.name}: "${char}" advances ${stated} in the PDF and ${inProgram} in the embedded font, but ${own} in the bundled font`)
      }
    }
  }
  return [...problems]
}

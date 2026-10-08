import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFArray, PDFName, PDFNumber } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { documentTexts } from '../src/lib/layoutModel'
import { cffHeaderProblem, withValidCffHeader } from '../src/writers/fontProgram'
import { FONT_METRICS, layoutPage, measureText } from '../src/writers/pageGeometry'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { cffTableOf, readCffStrict } from './cff'
import { fixtureDocuments } from './fixtureDocuments'
import { expectRecorded, readFont, root } from './helpers'
import { fontProblems, readPdfFonts, runWidth, type PdfFonts } from './pdfFonts'
import { readPdf } from './readPdf'

// The font of the PDF, checked the way a strict viewer sees it. The bug this guards against:
// the embedded font program had an invalid header, so viewers that check it (Chrome, Edge,
// xpdf) drew a substitute sans-serif font at Pagella's advances: "A BC Co Ltd", "PA YE".
// pdf.js forgives that header, so the pdf.js recordings alone could not see it.

describe('The font embedded in the PDF', () => {
  const docs = fixtureDocuments()
  const fonts = { regular: readFont('regular'), bold: readFont('bold') }
  const bundled = [fonts.regular, fonts.bold]
  // Every fixture: each payslip gets its own subset of each font, so each is checked.
  const samples = docs
  let written: Uint8Array[]
  let read: PdfFonts[]

  beforeAll(async () => {
    written = await Promise.all(samples.map((doc) => writePayslipPdf(doc, fonts)))
    read = await Promise.all(written.map((bytes) => readPdfFonts(bytes)))
  })

  it('reads back with no extra spaces: every text is exactly the text of the layout model', async () => {
    for (const [index, doc] of samples.entries()) {
      const expected = documentTexts(doc)
      // Through the PDF's own character table, one whole string per text...
      expect(read[index].runs.map((run) => run.text)).toEqual(expected)
      // ...and through pdf.js, which would split a text or add a space where it sees a gap.
      expect((await readPdf(written[index])).texts.map((t) => t.text)).toEqual(expected)
    }
  })

  it('uses the two bundled fonts and no other, on every fixture', () => {
    for (const pdf of read) expect(pdf.fonts.map((font) => font.name)).toEqual([FONT_METRICS.bold.postscriptName, FONT_METRICS.regular.postscriptName])
  })

  // One test per fixture and font, so a failure says exactly which font program is refused.
  const cases = docs.flatMap((doc, index) => (['regular', 'bold'] as const).map((weight) => [doc.employeeName, weight, index] as const))
  it.each(cases)('%s, %s: the embedded font program has a header a strict viewer accepts, and reads strictly', (_name, weight, index) => {
    const font = read[index].fonts.find((found) => found.name === FONT_METRICS[weight].postscriptName)
    expect(font?.program, 'the font program is embedded').toBeInstanceOf(Uint8Array)
    expect(cffHeaderProblem(font!.program!)).toBeNull()
    expect(() => readCffStrict(font!.program!)).not.toThrow()
  })

  it('embeds exactly the recorded font programs: any change in what the font library writes shows here', () => {
    const programs = samples.map((doc, index) => [
      doc.employeeName,
      read[index].fonts.map((font) => ({
        name: font.name,
        bytes: font.program?.length ?? null,
        sha256: font.program ? createHash('sha256').update(font.program).digest('hex') : null,
      })),
    ])
    expectRecorded('pdf-font-programs', Object.fromEntries(programs))
  })

  it('draws every glyph with the bundled font and at that font\'s own advance', () => {
    for (const pdf of read) expect(fontProblems(pdf, bundled)).toEqual([])
  })

  it('draws each text as one whole string, as wide as the shared geometry measured it', () => {
    for (const [index, doc] of samples.entries()) {
      const pdf = read[index]
      const page = layoutPage(doc)
      expect(pdf.otherTextOperators).toEqual([])
      expect(pdf.runs).toHaveLength(page.texts.length)
      for (const [at, run] of pdf.runs.entries()) {
        const text = page.texts[at]
        expect(run.font.name).toBe(FONT_METRICS[text.font].postscriptName)
        expect(Math.abs(runWidth(run) - measureText(text.text, text.font, text.size).width), text.text).toBeLessThan(0.01)
        expect([run.x, run.size], text.text).toEqual([text.x, text.size])
      }
    }
  })

  it('PROOF these checks can fail: a broken header, a wrong advance and a swapped font are each caught', async () => {
    const programs = async (change: (program: Uint8Array, name: string) => Uint8Array) => {
      const pdf = await readPdfFonts(written[0])
      for (const font of pdf.fonts) {
        pdf.pdf.context.assign(font.programRef!, pdf.pdf.context.flateStream(change(font.program!.slice(), font.name), { Subtype: font.programKind! }))
      }
      return readPdfFonts(await pdf.pdf.save())
    }

    // The bug itself: the offset size in the header (byte 3) is not 1 to 4.
    const brokenHeader = await programs((program) => {
      program[3] = 14
      return program
    })
    expect(fontProblems(brokenHeader, bundled).join('\n')).toMatch(/strict viewer refuses[\s\S]*offset size 14/)

    // The regular texts drawn with the bold font's glyphs.
    const boldProgram = read[0].fonts.find((font) => font.name === FONT_METRICS.bold.postscriptName)!.program!
    const swapped = await programs(() => boldProgram.slice())
    expect(fontProblems(swapped, bundled).join('\n')).toMatch(/TeXGyrePagella-Regular .*is not one of the bundled fonts/)

    // One glyph advancing 2/1000 more than the font says.
    const wide = await readPdfFonts(written[0])
    const regular = wide.fonts.find((font) => font.name === FONT_METRICS.regular.postscriptName)!
    const widths = regular.descendant.lookup(PDFName.of('W'), PDFArray).lookup(1, PDFArray)
    widths.set(0, PDFNumber.of(widths.lookup(0, PDFNumber).asNumber() + 2))
    expect(fontProblems(await readPdfFonts(await wide.pdf.save()), bundled).join('\n')).toMatch(/advances \d+ in the PDF and \d+ in the embedded font, but \d+ in the bundled font/)

    expect(fontProblems(read[0], bundled)).toEqual([])
  })
})

describe('The header of an embedded font program', () => {
  const program = (...header: number[]) => new Uint8Array([...header, 0, 1, 1, 1])

  it('gets the offset size 4 when the library wrote a number that is not 1 to 4, and nothing else changes', () => {
    const broken = program(1, 0, 4, 14)
    expect([...withValidCffHeader(broken)]).toEqual([...program(1, 0, 4, 4)])
    expect([...withValidCffHeader(program(1, 0, 4, 0))]).toEqual([...program(1, 0, 4, 4)])
    expect(broken[3]).toBe(14)
  })

  it('is left alone when it is already valid', () => {
    for (const offsetSize of [1, 2, 3, 4]) expect([...withValidCffHeader(program(1, 0, 4, offsetSize))]).toEqual([...program(1, 0, 4, offsetSize)])
  })

  it('stops the PDF when it is wrong in a way that cannot be repaired', () => {
    expect(() => withValidCffHeader(program(2, 0, 4, 4))).toThrow(/cannot be embedded.*major version 2/)
    expect(() => withValidCffHeader(program(1, 0, 3, 4))).toThrow(/cannot be embedded.*header size 3/)
    expect(() => withValidCffHeader(new Uint8Array([1, 0]))).toThrow(/cannot be embedded.*shorter than its header/)
  })

  it('is judged as the strict reader of the tests judges it', () => {
    expect(cffHeaderProblem(program(1, 0, 4, 14))).toBe('offset size 14 (valid is 1 to 4)')
    expect(cffHeaderProblem(program(1, 0, 4, 5))).toBe('offset size 5 (valid is 1 to 4)')
    expect(cffHeaderProblem(readFont('regular').subarray(0, 0))).not.toBeNull()
    expect(cffHeaderProblem(cffTableOf(readFont('regular')))).toBeNull()
    expect(cffHeaderProblem(cffTableOf(readFont('bold')))).toBeNull()
  })
})

describe('The preview and the PDF use the same font files', () => {
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8')
  const exportsSource = readFileSync(resolve(root, 'src/lib/exports.ts'), 'utf8')
  const files = { 400: 'texgyrepagella-regular.otf', 700: 'texgyrepagella-bold.otf' }

  it('the preview font is declared from the two files the PDF embeds, and nothing else', () => {
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]).filter((face) => face.includes("'Payslip Pagella'"))
    const declared = faces.map((face) => [Number(/font-weight:\s*(\d+)/.exec(face)![1]), [...face.matchAll(/url\('([^']+)'\)/g)].map((url) => url[1])])
    expect(declared).toEqual([
      [400, [`./assets/fonts/${files[400]}`]],
      [700, [`./assets/fonts/${files[700]}`]],
    ])
    expect(/\.paper text\s*\{[^}]*font-family:\s*'Payslip Pagella'/.test(css)).toBe(true)
  })

  it('the PDF export loads those same two files', () => {
    const imported = [...exportsSource.matchAll(/from '\.\.\/assets\/fonts\/([^'?]+)\?url'/g)].map((match) => match[1]).sort()
    expect(imported).toEqual(Object.values(files).sort())
  })
})

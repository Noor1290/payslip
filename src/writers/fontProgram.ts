// The header of the font program (CFF) embedded in the PDF.
//
// @pdf-lib/fontkit 1.1.1 writes an unrelated number into the header of a subset font program,
// where the offset size (1 to 4) belongs. Viewers that check the header (Chrome, Edge, xpdf)
// then refuse the font and draw a substitute sans-serif at this font's advances, which shows as
// gaps inside words ("A BC Co Ltd"). Nothing else in the font program is touched here.

const OFFSET_SIZE_AT = 3

/** Why a strict viewer refuses this font program at its header, or null when it accepts it. */
export function cffHeaderProblem(program: Uint8Array): string | null {
  if (program.length < 4) return 'the font program is shorter than its header'
  const [major, , headerSize, offsetSize] = program
  if (major !== 1) return `major version ${major} (must be 1)`
  if (headerSize < 4) return `header size ${headerSize} (must be at least 4)`
  if (offsetSize < 1 || offsetSize > 4) return `offset size ${offsetSize} (valid is 1 to 4)`
  return null
}

/** The same font program with a valid offset size in its header. Throws if the header is wrong in any other way. */
export function withValidCffHeader(program: Uint8Array): Uint8Array {
  const fixed = program.slice()
  // 4 is what the bundled font files carry, and what fontkit, the project this library was forked
  // from, writes today. No parser uses the value; strict ones only check that it is 1 to 4.
  if (fixed.length >= 4 && (fixed[OFFSET_SIZE_AT] < 1 || fixed[OFFSET_SIZE_AT] > 4)) fixed[OFFSET_SIZE_AT] = 4
  const problem = cffHeaderProblem(fixed)
  if (problem) throw new Error(`The payslip font cannot be embedded in the PDF: ${problem}.`)
  return fixed
}

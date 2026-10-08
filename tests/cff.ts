// A STRICT reader of a CFF font program, for the tests of the font embedded in the PDF.
// pdf.js forgives a malformed font program, so a PDF it reads back fine can still show a
// substitute font in other viewers. This reader refuses what strict viewers refuse:
//  - the header must say major version 1, a header of at least 4 bytes and an offset size of
//    1 to 4 (FreeType, used by Chrome, Edge and many others, and xpdf drop the font otherwise);
//  - every INDEX must have an offset size of 1 to 4 and offsets that start at 1, never go back
//    and stay inside the data;
//  - there is exactly one font, and a CID-keyed one starts its Top DICT with ROS.

export interface CffFont {
  name: string
  cidKeyed: boolean
  /** The glyph programs, by glyph index. */
  charStrings: Uint8Array[]
  /** For a CID-keyed font: the CID of each glyph index. */
  cids: number[] | null
  defaultWidthX: number
  nominalWidthX: number
  localSubrs: Uint8Array[]
  globalSubrs: Uint8Array[]
}

type Dict = Map<string, number[]>

function fail(reason: string): never {
  throw new Error(reason)
}

/** The 'CFF ' table of an OpenType font file. */
export function cffTableOf(otf: Uint8Array): Uint8Array {
  const view = new DataView(otf.buffer, otf.byteOffset, otf.byteLength)
  const tables = view.getUint16(4)
  for (let index = 0; index < tables; index++) {
    const entry = 12 + index * 16
    const tag = String.fromCharCode(otf[entry], otf[entry + 1], otf[entry + 2], otf[entry + 3])
    if (tag === 'CFF ') return otf.subarray(view.getUint32(entry + 8), view.getUint32(entry + 8) + view.getUint32(entry + 12))
  }
  return fail('The font file has no CFF table.')
}

function readIndex(data: Uint8Array, start: number, what: string): { items: Uint8Array[]; end: number } {
  if (start + 2 > data.length) fail(`${what} starts outside the font program`)
  const count = (data[start] << 8) | data[start + 1]
  if (count === 0) return { items: [], end: start + 2 }
  const offSize = data[start + 2]
  if (offSize < 1 || offSize > 4) fail(`${what} has offset size ${offSize} (valid is 1 to 4)`)
  const offsetAt = (index: number) => {
    let value = 0
    for (let byte = 0; byte < offSize; byte++) value = value * 256 + data[start + 3 + index * offSize + byte]
    return value
  }
  const base = start + 3 + (count + 1) * offSize - 1
  if (base + 1 > data.length) fail(`${what} is cut off`)
  if (offsetAt(0) !== 1) fail(`${what} does not start at offset 1`)
  const items: Uint8Array[] = []
  for (let index = 0; index < count; index++) {
    const from = offsetAt(index)
    const to = offsetAt(index + 1)
    if (to < from) fail(`${what} has offsets that go back`)
    if (base + to > data.length) fail(`${what} points outside the font program`)
    items.push(data.subarray(base + from, base + to))
  }
  return { items, end: base + offsetAt(count) }
}

function readReal(data: Uint8Array, start: number): { value: number; next: number } {
  let text = ''
  let at = start
  for (;;) {
    if (at >= data.length) fail('A number in a DICT is cut off')
    const byte = data[at++]
    for (const nibble of [byte >> 4, byte & 15]) {
      if (nibble === 15) return { value: Number(text), next: at }
      text += nibble < 10 ? String(nibble) : nibble === 10 ? '.' : nibble === 11 ? 'E' : nibble === 12 ? 'E-' : nibble === 14 ? '-' : fail('A number in a DICT is malformed')
    }
  }
}

function readDict(data: Uint8Array): { dict: Dict; order: string[] } {
  const dict: Dict = new Map()
  const order: string[] = []
  let operands: number[] = []
  let at = 0
  while (at < data.length) {
    const byte = data[at]
    if (byte <= 21) {
      const operator = byte === 12 ? `12 ${data[at + 1]}` : String(byte)
      at += byte === 12 ? 2 : 1
      dict.set(operator, operands)
      order.push(operator)
      operands = []
    } else if (byte === 28) {
      operands.push(((data[at + 1] << 8) | data[at + 2]) << 16 >> 16)
      at += 3
    } else if (byte === 29) {
      operands.push((data[at + 1] << 24) | (data[at + 2] << 16) | (data[at + 3] << 8) | data[at + 4])
      at += 5
    } else if (byte === 30) {
      const real = readReal(data, at + 1)
      operands.push(real.value)
      at = real.next
    } else if (byte >= 32 && byte <= 246) {
      operands.push(byte - 139)
      at += 1
    } else if (byte >= 247 && byte <= 250) {
      operands.push((byte - 247) * 256 + data[at + 1] + 108)
      at += 2
    } else if (byte >= 251 && byte <= 254) {
      operands.push(-(byte - 251) * 256 - data[at + 1] - 108)
      at += 2
    } else {
      fail(`A DICT holds the reserved byte ${byte}`)
    }
  }
  return { dict, order }
}

const ROS = '12 30'
const FD_ARRAY = '12 36'
const CHARSET = '15'
const CHAR_STRINGS = '17'
const PRIVATE = '18'
const SUBRS = '19'
const DEFAULT_WIDTH = '20'
const NOMINAL_WIDTH = '21'

function readCids(data: Uint8Array, offset: number, glyphs: number): number[] {
  const cids = [0]
  const format = data[offset]
  let at = offset + 1
  if (format === 0) {
    while (cids.length < glyphs) {
      cids.push((data[at] << 8) | data[at + 1])
      at += 2
    }
  } else if (format === 1 || format === 2) {
    while (cids.length < glyphs) {
      if (at + 2 + format > data.length) fail('The charset is cut off')
      const first = (data[at] << 8) | data[at + 1]
      const left = format === 1 ? data[at + 2] : (data[at + 2] << 8) | data[at + 3]
      for (let step = 0; step <= left && cids.length < glyphs; step++) cids.push(first + step)
      at += 2 + format
    }
  } else {
    fail(`The charset has the unknown format ${format}`)
  }
  return cids
}

/** Reads a bare CFF font program the way a strict viewer does. Throws with the reason it is refused. */
export function readCffStrict(data: Uint8Array): CffFont {
  if (data.length < 4) fail('The font program is shorter than its header')
  const [major, , headerSize, offSize] = data
  if (major !== 1) fail(`The font program header has major version ${major} (must be 1)`)
  if (headerSize < 4) fail(`The font program header says it is ${headerSize} bytes long (must be at least 4)`)
  if (offSize < 1 || offSize > 4) fail(`The font program header has offset size ${offSize} (valid is 1 to 4)`)

  const names = readIndex(data, headerSize, 'The Name INDEX')
  const tops = readIndex(data, names.end, 'The Top DICT INDEX')
  const strings = readIndex(data, tops.end, 'The String INDEX')
  const globalSubrs = readIndex(data, strings.end, 'The Global Subr INDEX')
  if (names.items.length !== 1 || tops.items.length !== 1) fail('The font program does not hold exactly one font')

  const top = readDict(tops.items[0])
  const cidKeyed = top.dict.has(ROS)
  if (cidKeyed && top.order[0] !== ROS) fail('The Top DICT of a CID-keyed font must start with ROS')

  const charStringsAt = top.dict.get(CHAR_STRINGS)?.[0] ?? fail('The Top DICT names no CharStrings')
  const charStrings = readIndex(data, charStringsAt, 'The CharStrings INDEX').items
  if (charStrings.length === 0) fail('The font program has no glyphs')

  let privateAt: number[] | undefined
  if (cidKeyed) {
    const fdArrayAt = top.dict.get(FD_ARRAY)?.[0] ?? fail('A CID-keyed font names no FDArray')
    const fontDicts = readIndex(data, fdArrayAt, 'The FDArray INDEX').items
    // The payslip fonts have one set of defaults; more than one would need FDSelect.
    if (fontDicts.length !== 1) fail(`The font program has ${fontDicts.length} font DICTs (this reader handles 1)`)
    privateAt = readDict(fontDicts[0]).dict.get(PRIVATE)
  } else {
    privateAt = top.dict.get(PRIVATE)
  }
  if (!privateAt || privateAt.length !== 2) fail('The font program names no Private DICT')
  const [privateSize, privateOffset] = privateAt
  if (privateOffset + privateSize > data.length) fail('The Private DICT is outside the font program')
  const priv = readDict(data.subarray(privateOffset, privateOffset + privateSize)).dict
  const subrsAt = priv.get(SUBRS)?.[0]

  return {
    name: String.fromCharCode(...names.items[0]),
    cidKeyed,
    charStrings,
    cids: cidKeyed ? readCids(data, top.dict.get(CHARSET)?.[0] ?? fail('A CID-keyed font names no charset'), charStrings.length) : null,
    defaultWidthX: priv.get(DEFAULT_WIDTH)?.[0] ?? 0,
    nominalWidthX: priv.get(NOMINAL_WIDTH)?.[0] ?? 0,
    localSubrs: subrsAt === undefined ? [] : readIndex(data, privateOffset + subrsAt, 'The Subrs INDEX').items,
    globalSubrs: globalSubrs.items,
  }
}

const subrBias = (count: number) => (count < 1240 ? 107 : count < 33900 ? 1131 : 32768)

/**
 * The advance width a glyph program states for itself, in font units: the optional first number
 * before its first drawing or hinting instruction, added to the font's nominal width.
 */
export function glyphWidth(font: CffFont, glyph: number): number {
  const stack: number[] = []
  // Returns the width's offset from the nominal width, null for "the default width", or
  // undefined when this (sub)program ended before saying.
  const run = (code: Uint8Array, depth: number): number | null | undefined => {
    if (depth > 10) fail('Glyph subroutines are nested too deep')
    let at = 0
    while (at < code.length) {
      const byte = code[at]
      if (byte === 28) {
        stack.push(((code[at + 1] << 8) | code[at + 2]) << 16 >> 16)
        at += 3
      } else if (byte >= 32 && byte <= 246) {
        stack.push(byte - 139)
        at += 1
      } else if (byte >= 247 && byte <= 250) {
        stack.push((byte - 247) * 256 + code[at + 1] + 108)
        at += 2
      } else if (byte >= 251 && byte <= 254) {
        stack.push(-(byte - 251) * 256 - code[at + 1] - 108)
        at += 2
      } else if (byte === 255) {
        stack.push(((code[at + 1] << 24) | (code[at + 2] << 16) | (code[at + 3] << 8) | code[at + 4]) / 65536)
        at += 5
      } else if (byte === 10 || byte === 29) {
        const subrs = byte === 10 ? font.localSubrs : font.globalSubrs
        const subr = subrs[(stack.pop() ?? fail('A subroutine call has no number')) + subrBias(subrs.length)]
        if (!subr) fail('A glyph calls a subroutine the font does not have')
        const found = run(subr, depth + 1)
        if (found !== undefined) return found
        at += 1
      } else if (byte === 11) {
        return undefined
      } else if (byte === 1 || byte === 3 || byte === 18 || byte === 23) {
        // hstem, vstem, hstemhm, vstemhm take pairs: one number too many is the width.
        return stack.length % 2 === 1 ? stack[0] : null
      } else if (byte === 19 || byte === 20) {
        return stack.length % 2 === 1 ? stack[0] : null
      } else if (byte === 21) {
        return stack.length > 2 ? stack[0] : null
      } else if (byte === 22 || byte === 4) {
        return stack.length > 1 ? stack[0] : null
      } else if (byte === 14) {
        return stack.length === 1 || stack.length === 5 ? stack[0] : null
      } else {
        fail(`A glyph starts with the unexpected instruction ${byte}`)
      }
    }
    return undefined
  }
  const code = font.charStrings[glyph] ?? fail(`The font program has no glyph ${glyph}`)
  const found = run(code, 0)
  if (found === undefined) fail(`Glyph ${glyph} never says how wide it is`)
  return found === null ? font.defaultWidthX : font.nominalWidthX + found
}

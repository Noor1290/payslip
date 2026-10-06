// Encoding check for every text file in the repo:
//   - valid UTF-8, no byte-order mark, no replacement character;
//   - no mojibake (UTF-8 read as Latin-1 and saved again);
//   - no non-ASCII character that is not in the recorded baseline, so a character cannot be
//     changed or slip in by accident. After a deliberate change:
//       node scripts/check-encoding.mjs --update
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselineFile = resolve(root, 'scripts/encoding-baseline.json')
const update = process.argv.includes('--update')

const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|txt|yml|yaml|svg)$|^\.(gitignore|npmrc)$|\.oxlintrc\.json$/
// Recordings are escaped JSON; the lock file and the licence are not ours to edit.
const SKIP = /^(package-lock\.json|src\/assets\/fonts\/|tests\/expected\/)/

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((file) => file && TEXT.test(file) && !SKIP.test(file) && existsSync(resolve(root, file)))

// Built from code points so this file itself stays plain ASCII.
const cp = (...codes) => String.fromCodePoint(...codes)
const MOJIBAKE = new RegExp(
  [
    `${cp(0xc3)}[${cp(0x80)}-${cp(0xbf)}]`, // a 2-byte character read as Latin-1
    `${cp(0xc2)}[${cp(0xa0)}-${cp(0xbf)}]`,
    cp(0xe2, 0x20ac), // curly quotes and dashes read as Windows-1252
    cp(0xef, 0xbb, 0xbf), // a byte-order mark read as text
  ].join('|'),
)
const REPLACEMENT = cp(0xfffd)
const problems = []
const found = {}

for (const file of tracked) {
  const bytes = readFileSync(resolve(root, file))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push(`${file}: starts with a byte-order mark`)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    problems.push(`${file}: is not valid UTF-8`)
    continue
  }
  if (text.includes(REPLACEMENT)) problems.push(`${file}: contains the replacement character`)
  if (MOJIBAKE.test(text)) problems.push(`${file}: contains mojibake`)
  const counts = {}
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code > 0x7e || (code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t')) {
      const key = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  if (Object.keys(counts).length > 0) found[file] = Object.fromEntries(Object.entries(counts).sort())
}

if (update) {
  writeFileSync(baselineFile, `${JSON.stringify(found, null, 2)}\n`)
  console.log(`Baseline written: ${Object.keys(found).length} files hold non-ASCII characters.`)
} else {
  const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {}
  for (const file of new Set([...Object.keys(found), ...Object.keys(baseline)])) {
    const now = JSON.stringify(found[file] ?? {})
    const before = JSON.stringify(baseline[file] ?? {})
    if (now !== before) problems.push(`${file}: non-ASCII characters changed. Before ${before}, now ${now}`)
  }
}

if (problems.length > 0) {
  console.error(`Encoding check FAILED:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`Encoding check passed: ${tracked.length} text files.`)

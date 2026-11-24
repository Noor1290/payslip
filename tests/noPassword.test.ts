// Hotfix 2 (24 November 2026): the dashboard no longer asks for its password before it answers this
// app, so no page may say it must be unlocked.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = resolve(import.meta.dirname, '../src')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : []
  })

describe('the words on the pages', () => {
  it('never say the dashboard must be unlocked', () => {
    const found = files(src).filter((file) => /must be unlocked|unlocked to issue/.test(readFileSync(file, 'utf8')))
    expect(found.map((file) => file.slice(src.length + 1))).toEqual([])
  })
})

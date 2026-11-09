import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { rememberTheme, storedTheme, THEME_KEY } from '../src/lib/theme'
import { root } from './helpers'

// Known issue 8 (TODO D6/E10): the chosen theme was forgotten on every reload. It is now the one
// thing kept in the browser: "light" or "dark", only once the theme button is clicked.

function memoryStore() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

describe('the theme is remembered in this browser', () => {
  it('keeps "light" or "dark" under one key, and reads it back', () => {
    const store = memoryStore()
    expect(storedTheme(store)).toBeNull()
    rememberTheme('light', store)
    expect([...store.items]).toEqual([[THEME_KEY, 'light']])
    expect(storedTheme(store)).toBe('light')
    rememberTheme('dark', store)
    expect(storedTheme(store)).toBe('dark')
  })

  it('ignores anything else under the key, and a browser that refuses storage', () => {
    const store = memoryStore()
    store.items.set(THEME_KEY, 'blue')
    expect(storedTheme(store)).toBeNull()
    const refusing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(storedTheme(refusing)).toBeNull()
    expect(() => rememberTheme('dark', refusing)).not.toThrow()
    expect(storedTheme(null)).toBeNull()
  })

  it('the app reads the stored theme on opening and stores it only from the theme button', () => {
    const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
    const main = readFileSync(resolve(root, 'src/main.tsx'), 'utf8')
    expect(app).toMatch(/storedTheme\(\) \?\?/)
    expect(app.match(/rememberTheme\(/g)).toHaveLength(1)
    expect(main).toMatch(/dataset\.theme = chosenTheme/)
  })
})

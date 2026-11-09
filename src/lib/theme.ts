// The light or dark theme (known issue 8, TODO D6/E10). The one thing this app keeps in the
// browser, decided by the owner on 8 November 2026: the word "light" or "dark", written only
// when the theme button is clicked. It is a display choice, never payroll data. Until it is
// clicked once, the app follows the computer's own setting, as before.

export type Theme = 'dark' | 'light'

export const THEME_KEY = 'payslip_theme'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The theme chosen earlier in this browser, or null when none was chosen (or storage is off). */
export function storedTheme(store: Store | null = browserStore()): Theme | null {
  try {
    const value = store?.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

/** Keeps the chosen theme for the next visit. If the browser refuses, it still applies until the page is closed. */
export function rememberTheme(theme: Theme, store: Store | null = browserStore()): void {
  try {
    store?.setItem(THEME_KEY, theme)
  } catch {
    // Storage full or switched off: nothing else to do.
  }
}

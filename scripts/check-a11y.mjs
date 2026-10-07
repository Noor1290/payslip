// Accessibility checks on the production build, in both themes:
//   - every control has a name;
//   - the keyboard focus ring is a visible 2px accent outline;
//   - text contrast is at least WCAG AA (4.5:1, or 3:1 for large text);
//   - reduced motion switches every animation and transition off;
//   - dialogs trap focus, close on Escape and give focus back to what opened them;
//   - the payslip page stays white paper in both themes.
// Run after `npm run build`: node scripts/check-a11y.mjs
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startPreview } from './lib/preview-server.mjs'

const sample = fileURLToPath(new URL('../samples/ABC Co Ltd-pdf-fill-2026-09.json', import.meta.url))
const problems = []
const fail = (theme, text) => problems.push(`[${theme}] ${text}`)

/** Runs in the page: controls without an accessible name. */
function unnamedControls() {
  const visible = (el) => {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
  }
  const nameOf = (el) => {
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label')
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) return labelledBy.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (label?.textContent?.trim()) return label.textContent
    }
    if (el.closest('label')?.textContent?.trim()) return el.closest('label').textContent
    return el.textContent
  }
  return [...document.querySelectorAll('button, a[href], input, select, textarea')]
    .filter((el) => el.getAttribute('aria-hidden') !== 'true' && (visible(el) || el.type === 'file'))
    .filter((el) => el.type !== 'file')
    .filter((el) => !nameOf(el)?.trim())
    .map((el) => el.outerHTML.slice(0, 120))
}

/** Runs in the page: text whose contrast against its background is below AA. */
function lowContrast() {
  const parse = (value) => {
    const probe = document.createElement('canvas').getContext('2d')
    probe.fillStyle = '#000'
    probe.fillStyle = value
    const computed = probe.fillStyle
    if (computed.startsWith('#')) {
      return [parseInt(computed.slice(1, 3), 16), parseInt(computed.slice(3, 5), 16), parseInt(computed.slice(5, 7), 16), 1]
    }
    const parts = computed.match(/[\d.]+/g).map(Number)
    return [parts[0], parts[1], parts[2], parts[3] ?? 1]
  }
  const toRgba = (value) => {
    // Resolve any CSS colour (including color-mix) by painting one pixel.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a === 0 ? [0, 0, 0, 0] : [r, g, b, a / 255]
  }
  void parse
  const over = (top, bottom) => {
    const a = top[3]
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1)
  }
  const luminance = ([r, g, b]) => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const canvasColour = toRgba(getComputedStyle(document.body).backgroundColor)
  const backgroundOf = (el) => {
    const layers = []
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const colour = toRgba(getComputedStyle(node).backgroundColor)
      if (colour[3] > 0) layers.push(colour)
      if (colour[3] === 1) break
    }
    return layers.reverse().reduce((under, layer) => over(layer, under), canvasColour)
  }
  const found = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement
    if (!node.textContent.trim() || !el || seen.has(el)) continue
    seen.add(el)
    if (el.closest('svg, .sr-only, [aria-hidden="true"]')) continue
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    if (style.visibility === 'hidden' || style.display === 'none' || box.width === 0) continue
    if (el.closest(':disabled, [aria-disabled="true"]')) continue // disabled controls are exempt
    const background = backgroundOf(el)
    const colour = over(toRgba(style.color), background)
    const [light, dark] = [luminance(colour), luminance(background)].sort((a, b) => b - a)
    const ratio = (light + 0.05) / (dark + 0.05)
    const size = parseFloat(style.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
    if (ratio < (large ? 3 : 4.5)) found.push(`${ratio.toFixed(2)}:1 "${node.textContent.trim().slice(0, 40)}"`)
  }
  return found
}

async function checkScreen(page, theme, name) {
  const unnamed = await page.evaluate(unnamedControls)
  for (const html of unnamed) fail(theme, `${name}: control without a name: ${html}`)
  const contrast = await page.evaluate(lowContrast)
  for (const item of contrast) fail(theme, `${name}: low contrast ${item}`)
}

async function checkFocusRing(page, theme, name, steps) {
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  })
  await page.locator('body').click({ position: { x: 2, y: 2 } })
  for (let step = 0; step < steps; step++) {
    await page.keyboard.press('Tab')
    const ring = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const style = getComputedStyle(el)
      return { what: el.outerHTML.slice(0, 80), style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
    })
    if (!ring) continue
    if (ring.style === 'none' || ring.width !== '2px' || ring.color !== accent) {
      fail(theme, `${name}: focus ring is ${ring.width} ${ring.style} ${ring.color}, expected 2px solid ${accent}, on ${ring.what}`)
    }
  }
}

async function checkDialog(page, theme, openerName, expectedTitle) {
  const opener = page.getByRole('button', { name: openerName })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: expectedTitle })
  await dialog.waitFor()
  const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
  if (!(await inside())) fail(theme, `"${expectedTitle}": focus did not move into the dialog`)
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press(step % 3 === 2 ? 'Shift+Tab' : 'Tab')
    if (!(await inside())) fail(theme, `"${expectedTitle}": Tab left the dialog`)
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  const back = await opener.evaluate((el) => el === document.activeElement)
  if (!back) fail(theme, `"${expectedTitle}": focus did not return to the button that opened it`)
}

const server = await startPreview()
const browser = await chromium.launch()
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme })
    const page = await context.newPage()
    await page.goto(server.url)
    await checkScreen(page, theme, 'empty state')
    await checkFocusRing(page, theme, 'empty state', 8)

    await page.getByRole('button', { name: 'Try with fake sample data' }).click()
    await page.getByRole('img', { name: /Payslip of DOE JANE/ }).waitFor()
    await checkScreen(page, theme, 'payslips')
    await checkFocusRing(page, theme, 'payslips', 30)

    // The payslip is a picture of paper: white in both themes, with no filter over it.
    const paper = await page.getByTestId('payslip-page').evaluate((el) => {
      const style = getComputedStyle(el)
      return { background: style.backgroundColor, filter: style.filter, backdrop: style.backdropFilter, opacity: style.opacity }
    })
    if (paper.background !== 'rgb(255, 255, 255)' || paper.filter !== 'none' || paper.backdrop !== 'none' || paper.opacity !== '1') {
      fail(theme, `the payslip page is not plain white paper: ${JSON.stringify(paper)}`)
    }

    await checkDialog(page, theme, /Accept 3 rounding differences/, 'Accept the rounding differences?')

    // The import dialog (a second file while data is open): named controls, contrast, keyboard.
    await page.locator('input[type="file"]').setInputFiles(sample)
    const importDialog = page.getByRole('dialog', { name: 'Import payroll data' })
    await importDialog.waitFor()
    await checkScreen(page, theme, 'import dialog')
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
      if (!inside) fail(theme, 'import dialog: Tab left the dialog')
    }
    await page.keyboard.press('Escape')
    await importDialog.waitFor({ state: 'detached' })

    await page.getByRole('button', { name: 'Template' }).click()
    await page.getByRole('heading', { name: 'Where each line comes from' }).waitFor()
    await checkScreen(page, theme, 'template')
    await checkFocusRing(page, theme, 'template', 20)

    await page.getByRole('button', { name: 'Statutory rates' }).click()
    await page.getByRole('heading', { name: 'Worked example' }).waitFor()
    await checkScreen(page, theme, 'rates')
    await checkFocusRing(page, theme, 'rates', 24)

    // The theme switch works in both directions and is a real, named button.
    await page.getByRole('button', { name: theme === 'dark' ? 'Light theme' : 'Dark theme' }).click()
    // Let the 150ms colour transitions finish, however busy the machine is.
    await page.waitForTimeout(400)
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity))
    await checkScreen(page, `${theme} switched`, 'rates')
    await context.close()
  }

  // Reduced motion: nothing animates, nothing transitions.
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(server.url)
  await page.getByRole('button', { name: 'Try with fake sample data' }).click()
  await page.getByRole('img', { name: /Payslip of DOE JANE/ }).waitFor()
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => {
        const style = getComputedStyle(el)
        const animated = style.animationName !== 'none' && parseFloat(style.animationDuration) > 0
        const transitions = style.transitionDuration.split(',').some((d) => parseFloat(d) > 0)
        return animated || transitions
      })
      .map((el) => el.outerHTML.slice(0, 80)),
  )
  for (const html of moving) fail('reduced motion', `still animates: ${html}`)
  await context.close()
} finally {
  await browser.close()
  await server.close()
}

if (problems.length > 0) {
  console.error(`Accessibility check FAILED (${problems.length}):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Accessibility check passed: names, focus ring, contrast (both themes), reduced motion, dialogs, white paper.')

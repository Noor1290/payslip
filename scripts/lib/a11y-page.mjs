// Checks that run INSIDE a page (or a frame): they are passed to evaluate(), so each one is
// self-contained. Shared by check-a11y.mjs (the app on its own) and check-bridge.mjs (the app
// inside the dashboard, where the rates and template pages can save).

/** Runs in the page: controls without an accessible name. */
export function unnamedControls() {
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
export function lowContrast() {
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

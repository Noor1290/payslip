// Hotfix 4: no button may lie outside its card, panel or dialog. Run in the app's frame; returns
// one line per button found outside (empty when all is well). A button inside a part that scrolls
// sideways (a wide table, the layout grid) is left out: scrolling reaches it.
export function buttonsOutside() {
  const found = []
  const holders = '.card, .panel, [role=dialog], [role=alertdialog], dialog'
  for (const button of document.querySelectorAll('button, a.btn')) {
    const box = button.getBoundingClientRect()
    if (box.width === 0 || box.height === 0 || button.closest('.sr-only, [hidden]')) continue
    let holder = button.parentElement
    let scrolls = false
    while (holder && !holder.matches(holders)) {
      const style = getComputedStyle(holder)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') scrolls = true
      holder = holder.parentElement
    }
    if (!holder || scrolls) continue
    const room = holder.getBoundingClientRect()
    if (box.left < room.left - 1 || box.right > room.right + 1) {
      found.push(`"${button.textContent.trim().slice(0, 60)}" (${Math.round(box.left)}-${Math.round(box.right)} in ${Math.round(room.left)}-${Math.round(room.right)})`)
    }
  }
  return [...new Set(found)]
}

/** The widths every page is looked at: wide screens, laptops, a tablet and a phone. */
export const WIDTHS = [1440, 1280, 1024, 900, 768, 390]

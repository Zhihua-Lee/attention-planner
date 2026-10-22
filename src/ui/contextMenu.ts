/**
 * Whether a right-click keeps the browser's own menu: in a text field, on a link or an image, over selected text
 * (to copy it), and for a long press on a touch screen (where the menu selects text). Everywhere else the app is an
 * app, not a page, and the browser menu (back, reload, save as, inspect) is left out.
 */
export function keepsBrowserMenu(target: EventTarget | null, selected: string, pointerType = 'mouse'): boolean {
  if (pointerType === 'touch' || pointerType === 'pen') return true;
  if (selected.trim()) return true;
  const el = target instanceof Element ? target : null;
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], a[href], img');
}

/** Leave out the browser's right-click menu where it does not help (see `keepsBrowserMenu`). */
export function quietContextMenu(doc: Document = document) {
  doc.addEventListener('contextmenu', (e) => {
    const pointerType = 'pointerType' in e ? String((e as PointerEvent).pointerType || 'mouse') : 'mouse';
    if (!keepsBrowserMenu(e.target, doc.getSelection()?.toString() ?? '', pointerType)) e.preventDefault();
  });
}

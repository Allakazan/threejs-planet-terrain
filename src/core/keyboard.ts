/**
 * True when a key event is aimed at a form field, so flight and debug bindings
 * stay out of the way while typing into the terrain panel.
 */
export function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
}

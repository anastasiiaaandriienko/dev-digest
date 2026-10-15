/* Which mounted FindingsPanel owns the j/k/a/d shortcuts. Every panel listens
   on `window`; without an owner one key press acted on the focused finding of
   EVERY open accordion (client spec §5). The owner is the panel the user last
   clicked or focused into; before any interaction, the first mounted (top) one. */

const mounted: string[] = [];
let active: string | null = null;

/** Register a mounted panel; returns its unregister function. */
export function registerPanel(id: string): () => void {
  mounted.push(id);
  return () => {
    const i = mounted.indexOf(id);
    if (i >= 0) mounted.splice(i, 1);
    if (active === id) active = null;
  };
}

/** Make this panel the keyboard owner (on pointer down / focus inside it). */
export function activatePanel(id: string): void {
  active = id;
}

export function ownsKeyboard(id: string): boolean {
  const owner = active != null && mounted.includes(active) ? active : mounted[0];
  return owner === id;
}

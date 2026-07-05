/**
 * Renderer motion primitives.
 *
 * Two transitions:
 *   1. Staggered fade-rise on first mount (.is-mounting + animation-delay).
 *   2. Marginalia glyph "draws itself" when a component transitions into an
 *      acted / closed / dismissed state. Uses SVG stroke-dasharray on the
 *      .stroke path inside the glyph.
 *
 * Both honor `prefers-reduced-motion`. CSS already disables animation 1
 * under that media query; here we mirror that for animation 2.
 */

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Apply a fade-rise stagger to all matching elements. Each element gets a
 * monotonically increasing `animation-delay`. Caller is responsible for
 * adding the `.is-mounting` class.
 */
export function staggerMount(els: HTMLElement[], stepMs = 36, capMs = 360): void {
  if (reducedMotion()) {
    for (const el of els) el.classList.remove('is-mounting');
    return;
  }
  els.forEach((el, i) => {
    el.style.animationDelay = `${Math.min(i * stepMs, capMs)}ms`;
    el.classList.add('is-mounting');
    // Strip the class once the animation has played so subsequent layout
    // shifts don't replay it.
    el.addEventListener(
      'animationend',
      () => {
        el.classList.remove('is-mounting');
        el.style.animationDelay = '';
      },
      { once: true },
    );
  });
}

/**
 * Draw the marginalia glyph by animating its .stroke path's stroke-dashoffset
 * from full length down to zero. Pure inline DOM — no library, no globals.
 */
export function drawGlyph(host: HTMLElement, durationMs = 600): void {
  const path = host.querySelector<SVGPathElement>('.stroke');
  if (!path) return;
  if (reducedMotion()) {
    // Snap to the drawn state.
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
    return;
  }
  // pathLength="100" is baked into the SVGs, so the animation math is trivial.
  path.style.strokeDasharray = '100';
  path.style.strokeDashoffset = '100';
  // Force a paint frame before transitioning.
  path.getBoundingClientRect();
  path.style.transition = `stroke-dashoffset ${durationMs}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
  path.style.strokeDashoffset = '0';
  path.addEventListener(
    'transitionend',
    () => {
      path.style.transition = '';
      path.style.strokeDasharray = '';
      path.style.strokeDashoffset = '';
    },
    { once: true },
  );
}

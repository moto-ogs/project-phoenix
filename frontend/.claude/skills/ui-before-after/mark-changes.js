// Outlines changed regions on the rendered page for a marked screenshot.
// Usage: SKILL.md, "Mark what changed". The caller appends the call
// `markChanges([[number, selector], ...])` and pipes both to the browser.
// A selector is one CSS selector (its first match is outlined) or a list of
// selectors (one outline around all their first matches).
// Sizes are chosen to stay legible after the pair composite halves the image.
globalThis.markChanges = (marks) => {
  // Pure red on purpose: a tool mark must not pass for the product's own red.
  const RED = "red";
  const PAD = 14; // the number badge then ends at the region's corner
  const BADGE = 36;
  document.querySelectorAll("[data-change-mark]").forEach((n) => n.remove());
  const pageWidth = document.documentElement.scrollWidth;
  const outside = [];
  for (const [number, target] of marks) {
    // One region may consist of neighbours without a common parent of their
    // own (two counters in a row): the outline then spans all of them.
    const rects = [target].flat().map((selector) => {
      const el = document.querySelector(selector);
      if (!el)
        throw new Error(
          `change mark ${number}: no element matches ${selector}`,
        );
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        throw new Error(`change mark ${number}: ${selector} is not visible`);
      }
      return rect;
    });
    const r = {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    };
    // A viewport screenshot shows only what the window shows: a region
    // beside, above or below it carries a mark nobody sees.
    // Checked per target: two targets on opposite sides of the window give
    // an outline that crosses it although neither is in it.
    const hidden = (rect) =>
      rect.top >= window.innerHeight ||
      rect.bottom <= 0 ||
      rect.left >= window.innerWidth ||
      rect.right <= 0;
    if (rects.some(hidden)) outside.push(number);
    const left = Math.max(r.left + window.scrollX - PAD, 2);
    const top = Math.max(r.top + window.scrollY - PAD, 2);
    const right = Math.min(r.right + window.scrollX + PAD, pageWidth - 2);
    const box = document.createElement("div");
    box.dataset.changeMark = String(number);
    box.style.cssText =
      `position:absolute;z-index:2147483647;pointer-events:none;box-sizing:border-box;` +
      `left:${left}px;top:${top}px;width:${right - left}px;` +
      `height:${r.bottom + window.scrollY + PAD - top}px;` +
      `border:4px solid ${RED};border-radius:12px;box-shadow:0 0 0 2px white`;
    // The badge sits on the top-left corner and moves inward at the page edge.
    const badge = document.createElement("span");
    badge.textContent = String(number);
    badge.style.cssText =
      `position:absolute;left:${-Math.min(BADGE / 2, left)}px;top:${-Math.min(BADGE / 2, top)}px;` +
      `min-width:${BADGE}px;height:${BADGE}px;padding:0 6px;box-sizing:border-box;` +
      `border-radius:${BADGE / 2}px;background:${RED};color:white;` +
      `font:700 22px/${BADGE}px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px white`;
    box.append(badge);
    document.documentElement.append(box);
  }
  const drawn = `${marks.length} change marks drawn`;
  return outside.length === 0
    ? drawn
    : `${drawn}; outside the window, scroll there or take a --full screenshot: ${outside.join(", ")}`;
};

// Text, der über einen Knopf oder anderen Text läuft (#7265: „2 Änderungen
// nicht gespeichert“ lag in der Speicherleiste am Telefon unter „Abbrechen“).
// Läuft nach jeder Story im Storybook-Test (`preview.tsx`, `afterEach`), in
// CI also für jede Kit-Story bei 414 px Breite.
//
// Gemeldet wird nur, was im normalen Fluss nebeneinander steht: Liegt auf dem
// Weg zum gemeinsamen Vorfahren ein `absolute`/`fixed`/`sticky`-Element (Menü,
// Popover, Plakette, sr-only-Text, angeheftete Tabellenspalte), ist die
// Überdeckung gewollt. Was ein Vorfahr mit
// `overflow` abschneidet (`truncate`), zählt nur, soweit es sichtbar bleibt.

const INTERACTIVE =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]';

/** Pixels two boxes must share in both directions to count as overlap. */
const MIN_OVERLAP_PX = 2;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersect(a: Box, b: Box): Box | null {
  const box = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return box.right - box.left >= MIN_OVERLAP_PX &&
    box.bottom - box.top >= MIN_OVERLAP_PX
    ? box
    : null;
}

function isVisible(element: Element): boolean {
  return element.checkVisibility({
    opacityProperty: true,
    visibilityProperty: true,
  });
}

function commonAncestor(a: Element, b: Element): Element | null {
  const chain = new Set<Element>();
  for (let node: Element | null = a; node; node = node.parentElement) {
    chain.add(node);
  }
  for (let node: Element | null = b; node; node = node.parentElement) {
    if (chain.has(node)) return node;
  }
  return null;
}

/** True when an element from `from` up to (not including) `stop` floats. */
function floatsBelow(from: Element, stop: Element): boolean {
  for (
    let node: Element | null = from;
    node && node !== stop;
    node = node.parentElement
  ) {
    const position = getComputedStyle(node).position;
    if (
      position === "absolute" ||
      position === "fixed" ||
      position === "sticky"
    )
      return true;
  }
  return false;
}

/**
 * The part of `box` that `from` (when it is the clipping parent of a text)
 * and its clipping ancestors leave visible.
 */
function clipped(box: Box, from: Element, includeSelf = false): Box | null {
  let visible: Box | null = box;
  for (
    let node = includeSelf ? from : from.parentElement;
    node && visible;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      visible = intersect(visible, node.getBoundingClientRect());
    }
  }
  return visible;
}

interface Piece {
  readonly element: Element;
  readonly label: string;
  readonly boxes: readonly Box[];
}

function textPieces(root: Element): Piece[] {
  const pieces: Piece[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const parent = node.parentElement;
    if (!text || !parent || !isVisible(parent)) continue;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(node);
    const boxes = [...range.getClientRects()]
      .map((rect) => clipped(rect, parent, true))
      .filter((box): box is Box => box !== null);
    if (boxes.length > 0) {
      pieces.push({ element: parent, label: `„${text.slice(0, 40)}“`, boxes });
    }
  }
  return pieces;
}

function controlPieces(root: Element): Piece[] {
  return [...root.querySelectorAll(INTERACTIVE)]
    .filter(isVisible)
    .map((element) => ({
      element,
      label: `<${element.tagName.toLowerCase()}> „${(element.textContent ?? element.getAttribute("aria-label") ?? "").trim().slice(0, 40)}“`,
      boxes: [element.getBoundingClientRect()].flatMap((rect) => {
        const box = clipped(rect, element);
        return box ? [box] : [];
      }),
    }));
}

function collide(text: Piece, other: Piece): boolean {
  if (text.element === other.element) return false;
  if (other.element.contains(text.element)) return false;
  if (text.element.contains(other.element)) return false;
  const ancestor = commonAncestor(text.element, other.element);
  if (!ancestor) return false;
  if (floatsBelow(text.element, ancestor)) return false;
  if (floatsBelow(other.element, ancestor)) return false;
  return text.boxes.some((a) => other.boxes.some((b) => intersect(a, b)));
}

/**
 * Every place where visible text lies over a control or over other text that
 * stands beside it in the normal flow. Empty when the layout holds.
 */
export function findTextCollisions(root: Element): string[] {
  const texts = textPieces(root);
  const controls = controlPieces(root);
  const found = new Set<string>();
  for (const [index, text] of texts.entries()) {
    for (const control of controls) {
      if (collide(text, control)) {
        found.add(`${text.label} liegt über ${control.label}`);
      }
    }
    for (const other of texts.slice(index + 1)) {
      if (collide(text, other)) {
        found.add(`${text.label} liegt über ${other.label}`);
      }
    }
  }
  return [...found];
}

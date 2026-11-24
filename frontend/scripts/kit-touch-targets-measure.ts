// Messung im Browser für kit-touch-targets.pw.ts (#8060). Die Funktion läuft
// per `page.evaluate` in der Story; Playwright überträgt nur ihren Quelltext.
// Deshalb steht alles, was sie braucht, in ihr selbst: keine Importe und
// keine Werte von außen außer dem Argument.

/** Ein bedienbares Element, das die Regel aus #8059 verletzt. */
export interface TouchTargetFinding {
  /** Rolle und Name, z. B. `button "Weitere Aktionen"`. */
  target: string;
  /**
   * `small`: Ein Tipp in den Kreis von 44 px um den Mittelpunkt trifft nicht
   * nur das Element. `overlap`: Die Trefferfläche eines anderen Elements
   * reicht über dessen Rand hinaus in die Fläche dieses Elements.
   */
  problem: "small" | "overlap";
  /** Lesbarer Befund für die Fehlermeldung. */
  detail: string;
  /**
   * Nur bei `small`: Rundum mindestens 24 px bis zum nächsten bedienbaren
   * Element. Die Ausnahme `abstand-24` aus #8059 greift nur dann.
   */
  clearance24?: boolean;
  /** Mittelpunkt im Dokument (CSS-Pixel), für Fehlersuche und Bilder. */
  center: { x: number; y: number };
}

export interface TouchTargetMeasureOptions {
  /** Durchmesser der geforderten Trefferfläche in CSS-Pixeln (44). */
  size: number;
  /** Abstand der Messpunkte in CSS-Pixeln. */
  step: number;
}

/**
 * Prüft jedes bedienbare Element der Seite mit `elementFromPoint`, also so,
 * wie der Browser einen Tipp zuordnet. `after:`-Flächen und Polsterung mit
 * Negativrand zählen dadurch mit; eine Bounding-Box sähe sie nicht.
 *
 * Ein Punkt zählt für ein Element, wenn der Tipp dort bei ihm landet: beim
 * Element selbst, bei einem Nachfahren ohne eigene Bedienung oder beim
 * zugehörigen `label` bzw. Feld. Gemessen wird ein Kreis mit `size` px
 * Durchmesser um den Mittelpunkt: Chrome spart abgerundete Ecken beim Treffer
 * aus, ein runder 44-px-Knopf erfüllte sonst kein Quadrat.
 *
 * Nicht geprüft werden Elemente, die der Nutzer in diesem Zustand nicht
 * antippen kann (versteckt, `disabled`, `inert`, hinter einem offenen Dialog
 * oder Menü), Hintergründe, die den ganzen Bildschirm füllen, Links im
 * Fließtext und Beschriftungen von Textfeldern (getippt wird ins Feld).
 */
export async function measureTouchTargets({
  size,
  step,
}: TouchTargetMeasureOptions): Promise<TouchTargetFinding[]> {
  const INTERACTIVE = [
    "button",
    "a[href]",
    "input:not([type=hidden])",
    "label",
    "[role=button]",
    "[role=link]",
    "[role=menuitem]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    "[role=option]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
  ].join(",");

  const clean = (text: string | null | undefined) =>
    (text ?? "").replace(/\s+/g, " ").trim();

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (el instanceof HTMLInputElement) {
      const type = el.type;
      if (type === "checkbox" || type === "radio") return type;
      if (type === "button" || type === "submit" || type === "reset")
        return "button";
      return "textbox";
    }
    return tag;
  };

  const nameOf = (el: Element): string => {
    const label = el.getAttribute("aria-label");
    if (clean(label)) return clean(label);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ");
      if (clean(text)) return clean(text);
    }
    if (el instanceof HTMLInputElement) {
      const fromLabels = Array.from(el.labels ?? [], (l) => l.textContent);
      if (clean(fromLabels.join(" "))) return clean(fromLabels.join(" "));
      return clean(el.placeholder || el.name);
    }
    return clean(el.textContent) || clean(el.getAttribute("title"));
  };

  const describe = (el: Element) => {
    const name = nameOf(el);
    const short = name.length > 40 ? `${name.slice(0, 39)}…` : name;
    return `${roleOf(el)} "${short}"`;
  };

  /** Element, das einen Tipp auf `hit` bekommt: das nächste bedienbare darüber. */
  const ownerOf = (hit: Element | null): Element | null =>
    hit?.closest(INTERACTIVE) ?? null;

  /** Elemente, deren Treffer für `el` zählen: es selbst und `label` bzw. Feld. */
  const acceptedFor = (el: Element): Element[] => {
    const set = [el];
    if (el instanceof HTMLInputElement)
      set.push(...Array.from(el.labels ?? []));
    if (el instanceof HTMLLabelElement && el.control) set.push(el.control);
    return set;
  };

  const related = (a: Element, b: Element) => a.contains(b) || b.contains(a);

  const isToggleInput = (el: Element | null | undefined) =>
    el instanceof HTMLInputElement &&
    (el.type === "checkbox" || el.type === "radio");

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  /** Punkt im sichtbaren Fenster; außerhalb liefert `elementFromPoint` nichts. */
  const onScreen = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < vw && y < vh;

  const skip = (el: Element): boolean => {
    if (el.closest("[inert],[aria-hidden=true]")) return true;
    if ((el as HTMLButtonElement).disabled) return true;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.pointerEvents === "none")
      return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true;
    // Hintergrund eines Dialogs oder Blatts: schließt bei Tipp daneben.
    if (rect.width >= vw - 1 && rect.height >= vh - 1) return true;
    // Vom Browser gezeichnete Bedienelemente (#8059): Größe bestimmt der Browser.
    if (
      el instanceof HTMLInputElement &&
      ["file", "range", "color"].includes(el.type)
    )
      return true;
    if (el instanceof HTMLLabelElement) {
      // Beschriftung eines Textfelds: Getippt wird ins Feld, das zählt dort.
      if (!isToggleInput(el.control)) return true;
      // Zeile eines deaktivierten Kästchens: nicht bedienbar.
      if ((el.control as HTMLInputElement).disabled) return true;
    }
    if (el instanceof HTMLInputElement && isToggleInput(el)) {
      // Verstecktes Kästchen in einer Zeile: Die Zeile (`label`) ist die Fläche.
      if ((rect.width < 4 || rect.height < 4) && (el.labels?.length ?? 0) > 0)
        return true;
    }
    if (el.tagName === "A" && style.display === "inline") {
      // Link im Fließtext (#8059): Teil eines Satzes.
      const own = clean(el.textContent).length;
      if (clean(el.parentElement?.textContent).length > own + 1) return true;
    }
    return false;
  };

  /**
   * Punkt im Rand von `r`, mit 1 px Spiel: `elementFromPoint` rundet die
   * Koordinaten, ein Punkt 0,1 px vor der Kante trifft schon den Nachbarn.
   */
  const inside = (r: DOMRect, x: number, y: number) =>
    x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;

  /** Punkt auf dem Rand von `r` (±1 px): Auf einer gemeinsamen Kante rundet Chrome mal so, mal so. */
  const onEdge = (r: DOMRect, x: number, y: number) =>
    inside(r, x, y) &&
    !(x > r.left + 1 && x < r.right - 1 && y > r.top + 1 && y < r.bottom - 1);

  const contains = (outer: DOMRect, inner: DOMRect) =>
    inner.left >= outer.left - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.bottom <= outer.bottom + 0.5;

  /**
   * Trifft der Punkt `el`, wenn `other` ihn nicht abfinge? Dann beanspruchen
   * beide Trefferflächen den Punkt: Sie überlappen. Ein bloßer Nachbar im
   * Kreis von 44 px macht das Element nur zu klein.
   */
  const claimedBelow = (
    other: Element,
    x: number,
    y: number,
    isOwn: (owner: Element | null) => boolean,
  ): boolean => {
    const style = (other as HTMLElement).style;
    const previous = style.pointerEvents;
    style.pointerEvents = "none";
    const below = ownerOf(document.elementFromPoint(x, y));
    style.pointerEvents = previous;
    return isOwn(below);
  };

  /** Kein fremdes Bedienelement im Band von 24 px rund um `rect`. */
  const hasClearance = (
    rect: DOMRect,
    el: Element,
    isOwn: (owner: Element | null) => boolean,
    isInnerControl: (owner: Element) => boolean,
  ): boolean => {
    const gap = 24;
    for (let x = rect.left - gap; x <= rect.right + gap; x += step) {
      for (let y = rect.top - gap; y <= rect.bottom + gap; y += step) {
        if (inside(rect, x, y)) continue;
        if (!onScreen(x, y)) continue;
        const owner = ownerOf(document.elementFromPoint(x, y));
        if (!owner || isOwn(owner) || related(owner, el)) continue;
        if (isInnerControl(owner)) continue;
        return false;
      }
    }
    return true;
  };

  /**
   * Gleichmäßige Abstände von −r bis +r, mit 0 und beiden Enden: Die vier
   * äußersten Punkte des Kreises (oben, unten, links, rechts) zählen mit,
   * sonst ginge ein 40 px hohes Feld als 44 px durch.
   */
  const circleRadius = size / 2 - 0.5;
  const circleSteps = Math.ceil((2 * circleRadius) / step / 2) * 2;
  const circleOffsets = Array.from(
    { length: circleSteps + 1 },
    (_, i) => -circleRadius + (2 * circleRadius * i) / circleSteps,
  );

  const findings: TouchTargetFinding[] = [];

  /** Misst ein Element an der Stelle, an der es gerade steht. */
  const measureOne = (el: Element): void => {
    const accepted = acceptedFor(el);
    const rect = el.getBoundingClientRect();
    const isOwn = (owner: Element | null) =>
      owner !== null && accepted.includes(owner);
    /** Bedienelement innerhalb der eigenen Fläche (Augen-Knopf im Passwortfeld). */
    const isInnerControl = (owner: Element) =>
      !related(owner, el) && contains(rect, owner.getBoundingClientRect());

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Trifft schon der Mittelpunkt etwas anderes, liegt ein Dialog, Menü
    // oder Blatt über dem Element: in diesem Zustand nicht antippbar.
    if (!isOwn(ownerOf(document.elementFromPoint(cx, cy)))) return;

    // 1. Eigene Fläche, 1 px nach innen: Wer trifft dort?
    let covered = false;
    let ownHits = 0;
    const intruders = new Set<Element>();
    const x0 = rect.left + 1;
    const x1 = rect.right - 1;
    const y0 = rect.top + 1;
    const y1 = rect.bottom - 1;
    const points: [number, number][] = [];
    const along = (from: number, to: number) => {
      const n = Math.max(1, Math.ceil((to - from) / step));
      return Array.from(
        { length: n + 1 },
        (_, i) => from + ((to - from) * i) / n,
      );
    };
    for (const x of along(x0, x1)) points.push([x, y0], [x, y1]);
    for (const y of along(y0, y1)) points.push([x0, y], [x1, y]);
    for (const x of along(x0, x1)) points.push([x, (y0 + y1) / 2]);
    for (const [x, y] of points) {
      if (!onScreen(x, y)) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      const owner = ownerOf(hit);
      if (isOwn(owner)) {
        ownHits++;
        continue;
      }
      // Rand des Elterns in einer abgerundeten Ecke, eigener Inhalt.
      if (hit.contains(el) || el.contains(hit)) continue;
      if (owner && accepted.some((a) => related(a, owner))) continue;
      if (owner && isInnerControl(owner)) continue;
      // Ein Abzeichen oder eine Fläche ohne Bedienung über dem Rand: zählt im
      // Kreis als Fehltreffer, nimmt das Element aber nicht aus der Prüfung.
      if (!owner) continue;
      if (!inside(owner.getBoundingClientRect(), x, y)) {
        // Die Fläche eines anderen reicht über seinen Rand hinaus hierher.
        intruders.add(owner);
        continue;
      }
      // Ein anderes Bedienelement liegt über diesem (offenes Menü).
      covered = true;
      break;
    }
    if (covered || ownHits === 0) return;

    const target = describe(el);
    const center = {
      x: Math.round(cx + scrollX),
      y: Math.round(cy + scrollY),
    };
    for (const other of intruders) {
      findings.push({
        target,
        problem: "overlap",
        center,
        detail: `die Trefferfläche von ${describe(other)} reicht in das Element`,
      });
    }

    // 2. Kreis mit `size` px um den Mittelpunkt.
    const radius = circleRadius;
    let total = 0;
    let missed = 0;
    const overlapping = new Set<Element>();
    const missedOn = new Map<string, number>();
    for (const dx of circleOffsets) {
      for (const dy of circleOffsets) {
        if (dx * dx + dy * dy > radius * radius + 0.01) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!onScreen(x, y)) continue;
        const owner = ownerOf(document.elementFromPoint(x, y));
        if (isOwn(owner)) {
          total++;
          continue;
        }
        if (owner && isInnerControl(owner)) continue;
        total++;
        missed++;
        const instead = owner ? describe(owner) : "Fläche ohne Bedienung";
        missedOn.set(instead, (missedOn.get(instead) ?? 0) + 1);
        if (
          owner &&
          !intruders.has(owner) &&
          !overlapping.has(owner) &&
          !related(owner, el) &&
          !(
            onEdge(rect, x, y) && onEdge(owner.getBoundingClientRect(), x, y)
          ) &&
          claimedBelow(owner, x, y, isOwn)
        ) {
          overlapping.add(owner);
        }
      }
    }
    for (const other of overlapping) {
      findings.push({
        target,
        problem: "overlap",
        center,
        detail: `die Trefferflächen von ${describe(other)} und diesem Element liegen übereinander`,
      });
    }
    if (missed > 0) {
      findings.push({
        target,
        problem: "small",
        center,
        detail: `${missed} von ${total} Punkten treffen nicht (Box ${Math.round(rect.width)} × ${Math.round(rect.height)} px), sondern ${[
          ...missedOn,
        ]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([what, count]) => `${what} (${count})`)
          .join(", ")}`,
        clearance24: hasClearance(rect, el, isOwn, isInnerControl),
      });
    }
  };

  /**
   * Bringt ein Element, das eine in sich scrollende Liste abschneidet, in
   * deren sichtbaren Teil, ohne das Fenster zu bewegen.
   */
  const revealInContainer = (el: Element): void => {
    for (let box = el.parentElement; box; box = box.parentElement) {
      if (box === document.body || box === document.documentElement) return;
      const style = getComputedStyle(box);
      const scrollsY =
        /auto|scroll/.test(style.overflowY) &&
        box.scrollHeight > box.clientHeight;
      const scrollsX =
        /auto|scroll/.test(style.overflowX) &&
        box.scrollWidth > box.clientWidth;
      if (!scrollsY && !scrollsX) continue;
      const outer = box.getBoundingClientRect();
      const inner = el.getBoundingClientRect();
      if (scrollsY && (inner.top < outer.top || inner.bottom > outer.bottom)) {
        box.scrollTop +=
          inner.top + inner.height / 2 - (outer.top + outer.height / 2);
      }
      if (scrollsX && (inner.left < outer.left || inner.right > outer.right)) {
        box.scrollLeft +=
          inner.left + inner.width / 2 - (outer.left + outer.width / 2);
      }
      return;
    }
  };

  const offScreen = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return (
      r.top < size / 2 || r.bottom > vh - size / 2 || r.left < 0 || r.right > vw
    );
  };

  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  // Erst alles, was ohne Fenster-Scrollen messbar ist: Ein Scrollen des
  // Fensters schließt offene Menüs (`OverflowMenu`), und wann React das
  // umsetzt, hängt an der Last. Verdeckte Elemente werden nie gescrollt.
  const later: Element[] = [];
  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    if (skip(el)) continue;
    if (offScreen(el)) {
      later.push(el);
      continue;
    }
    revealInContainer(el);
    measureOne(el);
  }
  // Dann die Elemente außerhalb des Fensters, jedes nach dem Scrollen in
  // Ruhe: drei Frames, in denen es an derselben Stelle steht.
  for (const el of later) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    let previous = "";
    for (let calm = 0, tries = 0; calm < 3 && tries < 60; tries++) {
      await frame();
      const r = el.getBoundingClientRect();
      const current = `${r.x},${r.y},${r.width},${r.height}`;
      calm = current === previous ? calm + 1 : 0;
      previous = current;
    }
    if (!el.isConnected || skip(el)) continue;
    revealInContainer(el);
    measureOne(el);
  }
  if (scrollX || scrollY) window.scrollTo(0, 0);
  return findings;
}

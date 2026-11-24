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
export function measureTouchTargets({
  size,
  step,
}: TouchTargetMeasureOptions): TouchTargetFinding[] {
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
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
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
  const circleRadius = size / 2 - 1;
  const circleSteps = Math.ceil((2 * circleRadius) / step / 2) * 2;
  const circleOffsets = Array.from(
    { length: circleSteps + 1 },
    (_, i) => -circleRadius + (2 * circleRadius * i) / circleSteps,
  );

  const findings: TouchTargetFinding[] = [];

  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    if (skip(el)) continue;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    const accepted = acceptedFor(el);
    const isOwn = (owner: Element | null) =>
      owner !== null && accepted.includes(owner);
    /** Bedienelement innerhalb der eigenen Fläche (Augen-Knopf im Passwortfeld). */
    const isInnerControl = (owner: Element) =>
      !related(owner, el) && contains(rect, owner.getBoundingClientRect());

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
      if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
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
      if (owner && !inside(owner.getBoundingClientRect(), x, y)) {
        // Die Fläche eines anderen reicht über seinen Rand hinaus hierher.
        intruders.add(owner);
        continue;
      }
      // Ein Menü, Dialog oder anderes Element liegt über diesem.
      covered = true;
      break;
    }
    if (covered || ownHits === 0) continue;

    const target = describe(el);
    for (const other of intruders) {
      findings.push({
        target,
        problem: "overlap",
        detail: `die Trefferfläche von ${describe(other)} reicht in das Element`,
      });
    }

    // 2. Kreis mit `size` px um den Mittelpunkt.
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
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
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
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
        detail: `die Trefferflächen von ${describe(other)} und diesem Element liegen übereinander`,
      });
    }
    if (missed > 0) {
      findings.push({
        target,
        problem: "small",
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
  }
  window.scrollTo(0, 0);
  return findings;
}

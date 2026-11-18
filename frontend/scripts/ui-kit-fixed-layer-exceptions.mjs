// Fixed layers that deliberately do not carry `FIXED_LAYER_SHIFT`
// (`ui-kit/fixed-layer-follows-viewport`). Each entry names the file and a
// piece of the exact class string, so a new fixed layer in the same file is
// still checked. A new entry needs a reason a reviewer can verify.
//
// Why anchored layers stay out: `getBoundingClientRect()` and
// `position: fixed` both measure from the layout viewport. A panel placed at
// its trigger's rect therefore sits at the trigger in the iOS 26 standalone
// bug too; the shift would move it away from the trigger by `offsetTop`.
export const fixedLayerShiftExceptions = [
  {
    file: "src/components/ui/date-picker.tsx",
    match: "max-h-[calc(100dvh-1rem)] overflow-x-hidden",
    reason:
      "Kalender hängt am Feld: top/left kommen aus getBoundingClientRect() des Feldes.",
  },
  {
    file: "src/components/ui/page-header/OverflowMenu.tsx",
    match: "scrollbar-thin overflow-x-hidden",
    reason:
      "Menü hängt am Auslöser: Position aus getBoundingClientRect() des Knopfs.",
  },
  {
    file: "src/components/ui/action-hint.tsx",
    match: "fixed w-max max-w-xs",
    reason:
      "Hinweisblase hängt am Element: Position aus getBoundingClientRect().",
  },
  {
    file: "src/components/ui/drawer.tsx",
    match: "fixed inset-",
    reason:
      "Richtungsklassen des Blatts; DrawerContent hängt FIXED_LAYER_SHIFT im selben cn() an.",
  },
  {
    file: "src/components/ui/portal-shell.tsx",
    match: "-translate-y-20 focus-visible:translate-y-0",
    reason:
      "Sprunglink, nur mit Tastaturfokus sichtbar; sein translate-y kollidiert mit der Verschiebung.",
  },
  {
    file: "src/components/help/help-view.tsx",
    match: "-translate-y-20 focus-visible:translate-y-0",
    reason:
      "Sprunglink, nur mit Tastaturfokus sichtbar; sein translate-y kollidiert mit der Verschiebung.",
  },
  {
    file: "src/components/tenant/pwa-install-hint.tsx",
    match: "left-1/2 z-40",
    reason:
      "Erscheint nur im Browser-Tab, nie in der installierten App, in der der Fehler auftritt.",
  },
];

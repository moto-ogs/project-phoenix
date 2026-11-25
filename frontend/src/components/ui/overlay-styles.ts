/** Visual policy shared by every UI-kit surface that obscures page content. */

/**
 * Tint of the backdrop: one color and one opacity for Modal, FormModal,
 * Drawer and SlideOver, so stacked or adjacent overlays dim the page in the
 * same gray instead of three different ones (#2932).
 *
 * The blur comes from `OVERLAY_BACKDROP_BLUR_CLASS` on the same element.
 */
export const OVERLAY_BACKDROP_TINT_CLASS = "bg-black/40";

/**
 * Blurs the page behind an overlay, together with the tint and from its first
 * frame, as before #7252 (`.moto-overlay-blur` in globals.css). A blur that
 * set in only after the panel had landed read as "grey first, blur later"
 * and was reverted.
 */
export const OVERLAY_BACKDROP_BLUR_CLASS = "moto-overlay-blur";

/**
 * Panel look of the centered dialog (`Modal`, and through it `FormModal`,
 * `ConfirmationModal`, `ChoiceModal`, `ConfirmDeleteModal`): soft white
 * gradient and a deep shadow with a hint of brand blue. Opaque instead of
 * glass: a `backdrop-filter` blur under the panel was redrawn in every frame
 * of its scale animation, and without it the page would show through.
 */
export const OVERLAY_PANEL_STYLE = {
  background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
  boxShadow:
    "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 8px 16px -8px rgba(80, 128, 216, 0.15)",
  animationFillMode: "both",
} as const;

/**
 * Klebt am unteren Rand einer Seite. Unter `lg` liegt dort die untere
 * Navigation, die Leiste steht dann darüber.
 */
export const STICKY_ABOVE_BOTTOM_NAV =
  "sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-4";

/**
 * Stacking order of everything that floats above the page, lowest first:
 * the one token set for levels in the kit. Every kit surface takes its level
 * from here instead of writing a number; a new level goes here with the
 * reason it sits where it does. `ui-kit/no-raw-z-index` fails a `z-…` class
 * anywhere else in the kit.
 *
 * Literal class strings so Tailwind finds them. `Z_INDEX` reads the numbers
 * for inline `style.zIndex` from these classes, and the overlay stack orders
 * open overlays by them (`overlay-stack.ts`).
 */
export const Z_LAYER = {
  /** Background layer of the portal shell, below its content. */
  base: "z-0",
  /**
   * Above the siblings inside the same component: sticky table columns,
   * scroll fades, the close X over a dialog body, the portal content.
   */
  raised: "z-10",
  /** Sticky bars at the bottom of a page and tooltips, below the nav. */
  sticky: "z-20",
  /** Mobile bottom navigation; a selection bar sticking to the top. */
  nav: "z-30",
  /** Sticky portal header. */
  header: "z-40",
  /** Floating action buttons, level with the header. */
  fab: "z-40",
  /** Backdrop of a side panel (`SlideOver`), below its panel. */
  sheetBackdrop: "z-40",
  /**
   * Click-catcher of the filter panel: above nav and FABs, so an outside tap
   * closes the panel instead of firing a FAB, below the panel itself.
   */
  panelBackdrop: "z-[45]",
  /** Drawer, slide-over and filter panels, the full-page loading veil. */
  sheet: "z-50",
  /** In-flow dropdown menus anchored below their trigger. */
  dropdown: "z-50",
  /** Centered dialogs (`Modal` and everything built on it). */
  modal: "z-[9999]",
  /** Guided-tour coach mark: above open dialogs, below popovers. */
  coach: "z-[10000]",
  /** Portaled select menus: above dialogs, below calendars. */
  menu: "z-[10000]",
  /** Calendars and anchored popovers, also when opened from a dialog. */
  popover: "z-[10001]",
  /**
   * Menus opened from inside a popover or calendar (overflow menu in an
   * `AnchoredPopover`, month/year select in the calendar).
   */
  popoverMenu: "z-[10002]",
  /**
   * Action hints of buttons (`ActionHint`), topmost: they also belong to
   * buttons inside dialogs, popovers and menus, and never take a click.
   */
  tooltip: "z-[10003]",
} as const;

export type ZLayer = keyof typeof Z_LAYER;

/** The number behind a `Z_LAYER` class (`z-50`, `z-[9999]`). */
export function zLayerValue(layer: ZLayer): number {
  return Number(/\d+/.exec(Z_LAYER[layer])?.[0]);
}

/** `Z_LAYER` levels as numbers for inline `style.zIndex`. */
export const Z_INDEX = {
  /** Portaled select menus: above dialogs, below calendars. */
  menu: zLayerValue("menu"),
  /** Anchored popover panels and calendars. */
  popover: zLayerValue("popover"),
  /**
   * Menus opened from inside a popover or calendar (overflow menu in an
   * `AnchoredPopover`, month/year select in the calendar).
   */
  popoverMenu: zLayerValue("popoverMenu"),
  /**
   * Action hints of buttons (`ActionHint`): they also belong to buttons inside
   * dialogs, popovers and menus, and never take a click.
   */
  tooltip: zLayerValue("tooltip"),
} as const;

/**
 * Eine Fußleiste in der App (#8070): eine Reihe, Hauptaktion rechts, auf
 * jedem Gerät gleich. Stapelt der Aufrufer seine Knöpfe am Telefon
 * (`flex-col`), stellt die Regel sie wieder nebeneinander.
 */
export const APP_FOOTER_ROW =
  "app:[&>div]:flex-row app:[&>div]:flex-nowrap app:[&>div>*]:flex-1";

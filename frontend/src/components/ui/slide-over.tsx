"use client";

/**
 * SlideOver — detail panel primitive built on Vaul. Slides in from the right on
 * a desktop-sized viewport and up from the bottom on a phone.
 *
 * Companion to ./drawer.tsx (bottom-sheet). The two share the same Vaul
 * primitives but differ in `direction` and the resulting Tailwind layout.
 * Use SlideOver for desktop-first detail panels that need to coexist with
 * the underlying view (planner grid → click instance → slide-over from
 * right). Use Drawer when a surface should be a bottom sheet at every size.
 *
 * Warum die Richtung mitwandert: ein von rechts einfahrendes 92vw-Panel ist auf
 * einem Handy ein Fremdkörper — dort ist das Blatt von unten die erwartete
 * Geste, und die App benutzt sie an anderer Stelle längst (das "Mehr"-Menü der
 * Bottom-Navigation). Vaul richtet Drag-Achse und Animation am `direction`-Prop
 * der Wurzel aus, deshalb ist das eine echte Breakpoint-Abfrage (matchMedia)
 * und keine reine CSS-Angelegenheit.
 *
 * Usage:
 * ```tsx
 * <SlideOver open={selected !== null} onOpenChange={(o) => !o && clear()}>
 *   <SlideOverContent>
 *     <SlideOverHeader>
 *       <SlideOverTitle>Mensa</SlideOverTitle>
 *       <SlideOverDescription>Mittwoch, 24.09.2026</SlideOverDescription>
 *     </SlideOverHeader>
 *     <SlideOverBody error={saveError}>…</SlideOverBody>
 *     <SlideOverFooter>…</SlideOverFooter>
 *   </SlideOverContent>
 * </SlideOver>
 * ```
 *
 * `SlideOverHeader` is a row: title and description on the left, the close X on
 * the right. `SlideOverFooter` is a right-aligned row of actions. `size` on
 * `SlideOverContent` picks the desktop width (`md`, `lg`, `xl`); without it the
 * panel keeps its narrow 420 px.
 *
 * `SlideOverBody` is the scrolling middle; its `error` prop is the fixed slot
 * for a form's validation or save error (BAUARTEN-SPEC, Bauart 2 Regel 5), so
 * no panel places that alert on its own.
 *
 * A panel that saves passes `pending` from `useFormModalPending(open)` and
 * runs every save through its `run` (#6593). While a save runs, the panel
 * locks every way to close it (X, Escape, backdrop, swipe) and every footer
 * action, and marks itself `aria-busy`; `ui-kit/slide-over-pending` fails a
 * panel without it. `isDismissDisabled` locks only the ways to close it, as
 * on `Modal` (#6575).
 *
 * Focus (#7502): on open the panel itself takes the focus, unless a field in
 * it focuses itself (`autoFocus`). On close it returns to what opened the
 * panel. A trigger that a save renders anew elsewhere (a list row moving to
 * another group) carries a stable `data-focus-return` key; the focus then
 * goes to the element with that key. A control that hides such a trigger (the
 * name of a collapsed group) lists the keys of what it hides in the same
 * attribute, separated by spaces, and takes the focus in its place. When
 * neither exists any more (the row left the list), the focus goes to the
 * first control of the trigger's `data-focus-return-scope` ancestor, so the
 * keyboard stays in that part of the page.
 */

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { BELOW_SM, useResolvedMediaQuery } from "~/lib/hooks/use-media-query";
import { cn } from "~/lib/utils";
import { ActionHint } from "./action-hint";
import { buttonClassName } from "./button";
import { useKitDefault } from "./kit-locale";
import { CloseIcon } from "./close-icon";
import { ICON_ONLY } from "./control-geometry";
import { DialogActions, DialogErrorSlot } from "./dialog-parts";
import { useBusyFocus } from "./hooks/useBusyFocus";
import { InOverlayContext } from "./in-overlay";
import { useSheetAboveKeyboard } from "./hooks/useSheetAboveKeyboard";
import { useIsApp } from "~/lib/device-context";
import {
  SheetSessionProvider,
  useParentSheetId,
  useSheetCovered,
  useSheetSession,
} from "./sheet-session";
import type { FormModalPending } from "./use-form-modal-pending";
import type { FormErrorInput } from "./form-error";
import {
  APP_FOOTER_ROW,
  OVERLAY_BACKDROP_BLUR_CLASS,
  OVERLAY_BACKDROP_TINT_CLASS,
  Z_LAYER,
} from "./overlay-styles";
import { isInsideModal, SHEET_SCOPE_PROPS, useOverlay } from "./overlay-stack";
import { FOCUSABLE_SELECTOR, useScrollRegion } from "./hooks/useScrollRegion";
import { FIXED_LAYER_SHIFT } from "./hooks/useFixedLayersFollowViewport";
import { SHEET_TABLET_CARD_CLASSES } from "./drawer";

/**
 * Unter sm fährt das Panel von unten ein, darüber von rechts. Im Server-Render
 * und während der Hydration gilt "right", damit Server- und Client-Render
 * übereinstimmen. Die Auflösung wird separat mitgegeben, damit ein beim Laden
 * bereits offenes Panel einmalig die korrekte Richtung übernehmen kann. Ein
 * Panel, das erst im Client eingehängt wird, kennt die Richtung schon im
 * ersten Render (#8013): Es entsteht am Telefon nicht erst von rechts und
 * dann noch einmal von unten.
 */
function useSlideOverDirection(): {
  direction: "right" | "bottom";
  isResolved: boolean;
} {
  const belowSm = useResolvedMediaQuery(BELOW_SM);
  // In der App (auch iPad hoch und quer) ist das Panel das eine Blatt der
  // App: von unten, am iPad als Karte (#8070). Der Desktop behält die Seite.
  const app = useIsApp();
  return {
    direction: belowSm === true || app ? "bottom" : "right",
    isResolved: belowSm !== null,
  };
}

const SlideOverDirectionContext = React.createContext<"right" | "bottom">(
  "right",
);
/** True while the panel's save runs (`pending`): footer actions are locked. */
const SlideOverBusyContext = React.createContext(false);
/** True while every way to close the panel is locked (busy or `isDismissDisabled`). */
const SlideOverDismissLockedContext = React.createContext(false);
/** Whether the surrounding panel currently locks dismissal actions. */
function useSlideOverDismissDisabled(): boolean {
  return React.useContext(SlideOverDismissLockedContext);
}
/**
 * False once the panel is closed. Vaul keeps it on screen while it slides
 * out; its footer must not start a save then that the next opening would
 * count as its own.
 */
const SlideOverOpenContext = React.createContext(true);

/**
 * What had the focus when the panel opened, and whether it is open (#7502).
 * Kept at the root: Vaul's instance below is rebuilt with `key={direction}`,
 * and a caller may unmount the whole panel instead of closing it.
 */
type SlideOverReturnFocus = {
  trigger: HTMLElement | null;
  /** The trigger's `data-focus-return-scope` ancestor, read while it exists. */
  scope: HTMLElement | null;
  /**
   * The opener of an earlier opening whose focus was never handed back: a
   * panel opened from this one suspended it, and resuming it finds the focus
   * inside that second panel.
   */
  previous: HTMLElement | null;
  open: boolean;
};
const SlideOverReturnFocusContext = React.createContext<{
  readonly current: SlideOverReturnFocus;
}>({ current: { trigger: null, scope: null, previous: null, open: false } });

/**
 * The element the focus returns to on close: the trigger, or, when a save
 * re-rendered it elsewhere (a list row that moves to another group), the
 * element that now carries the trigger's `data-focus-return` key (#7502).
 * `~=` also finds a control that lists the key among those it hides.
 */
function findReturnTarget(trigger: HTMLElement | null): HTMLElement | null {
  if (!trigger) return null;
  if (trigger.isConnected) return trigger;
  // A trigger that stands in for others carries several keys; its own
  // successor is whatever carries the first.
  const key = trigger.dataset.focusReturn?.split(/\s+/).find(Boolean);
  if (!key) return null;
  return document.querySelector<HTMLElement>(
    `[data-focus-return~="${CSS.escape(key)}"]`,
  );
}

/**
 * Hands the focus back without moving the page under a pointer. With the
 * keyboard the target must be in view: a row that a save moved below the
 * fold would otherwise hold the focus out of sight.
 */
function focusReturnTarget(target: HTMLElement) {
  target.focus({ preventScroll: true });
  let keyboard = false;
  try {
    keyboard = target.matches(":focus-visible");
  } catch {
    // An engine without the selector: the page stays where it is.
  }
  if (keyboard) target.scrollIntoView({ block: "nearest" });
}

/**
 * The controls Tab reaches in a container, in order. `tabIndex` leaves out
 * what only a script focuses (`tabindex="-1"`).
 */
function tabStops(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((control) => control.tabIndex >= 0);
}

/**
 * The first of the controls that takes the focus; a hidden one refuses.
 * `preventScroll` only where the caller decides about scrolling afterwards:
 * a key press must bring its target into view.
 */
function focusFirstOf(
  controls: HTMLElement[],
  options?: FocusOptions,
): HTMLElement | null {
  for (const control of controls) {
    control.focus(options);
    if (document.activeElement === control) return control;
  }
  return null;
}

// Vaul's props are a union (with or without `fadeFromIndex`); a plain Omit
// would merge its members.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * Vaul's `dismissible` is not offered: the lock is `isDismissDisabled`, the
 * one name for it in every kit dialog (#6575).
 */
type SlideOverProps = DistributiveOmit<
  React.ComponentProps<typeof DrawerPrimitive.Root>,
  "dismissible"
> & {
  /**
   * The pending contract from `useFormModalPending(open)` (#6593). While its
   * save runs, every way to close the panel (X, Escape, backdrop, swipe) and
   * every footer action is locked, the X shows as disabled and the panel is
   * `aria-busy`: a request that still commits must not look cancelled. Every
   * panel that saves passes it; `ui-kit/slide-over-pending` fails one
   * without it.
   */
  pending?: FormModalPending;
  /**
   * Locks every way to close the panel (X, Escape, backdrop, swipe) while an
   * operation must finish in place, without locking the footer. The one name
   * for this lock in every kit dialog, as on `Modal` (#6575).
   */
  isDismissDisabled?: boolean;
};

const SlideOver = ({
  shouldScaleBackground = false,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  pending,
  isDismissDisabled = false,
  ...props
}: SlideOverProps) => {
  const busy = pending?.pending ?? false;
  const dismissLocked = busy || isDismissDisabled;
  const { direction: preferredDirection, isResolved } = useSlideOverDirection();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const [direction, setDirection] = React.useState(preferredDirection);
  const appliedInitialDirection = React.useRef(false);

  // Vaul übernimmt `direction` nur beim Mount. Ein Richtungswechsel mit
  // `key={direction}` darf deshalb nicht passieren, solange ein Formular im
  // Panel offen ist: Das würde dessen lokalen, noch nicht gespeicherten State
  // verwerfen. Die erste Client-Auflösung ist davon ausgenommen: Zu diesem
  // Zeitpunkt konnte noch kein Nutzer im Panel arbeiten, und ein per Deep-Link
  // sofort offenes Panel muss auf einem Telefon von unten erscheinen. Nach dem
  // Schließen darf der nächste Öffnungsvorgang die dann passende Vaul-Instanz
  // verwenden.
  React.useEffect(() => {
    if (!isResolved) return;

    if (!appliedInitialDirection.current) {
      appliedInitialDirection.current = true;
      setDirection(preferredDirection);
      return;
    }

    if (!open) setDirection(preferredDirection);
  }, [isResolved, open, preferredDirection]);

  // Read in the commit that opens the panel: Radix mounts the portalled
  // panel one commit later, so a field with `autoFocus` has not taken the
  // focus yet.
  const returnFocusRef = React.useRef<SlideOverReturnFocus>({
    trigger: null,
    scope: null,
    previous: null,
    open: false,
  });
  React.useLayoutEffect(() => {
    const state = returnFocusRef.current;
    if (open && !state.open) {
      const active = document.activeElement;
      const opener =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      if (opener !== state.trigger) {
        // An opener still waiting for its focus stays as the fallback: the
        // new one may be gone by the time this panel closes.
        if (findReturnTarget(state.trigger)) state.previous = state.trigger;
        state.trigger = opener;
      }
      state.scope =
        opener?.closest<HTMLElement>("[data-focus-return-scope]") ?? null;
    }
    state.open = open;
  }, [open]);
  React.useLayoutEffect(() => {
    const state = returnFocusRef.current;
    return () => {
      state.open = false;
    };
  }, []);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && dismissLocked) return;
      setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [dismissLocked, onOpenChange],
  );

  // In der App hängt das Panel am Verlauf: Zurück schließt es, ein zweites
  // Blatt ersetzt es (#8070). Auf dem Desktop bleibt die Sitzung aus.
  const isApp = useIsApp();
  const sheetSessionId = useSheetSession(
    open,
    () => handleOpenChange(false),
    isApp,
  );

  return (
    <SheetSessionProvider value={isApp ? sheetSessionId : null}>
      <SlideOverDirectionContext.Provider value={direction}>
        <SlideOverBusyContext.Provider value={busy}>
          <SlideOverDismissLockedContext.Provider value={dismissLocked}>
            <SlideOverOpenContext.Provider value={open}>
              <SlideOverReturnFocusContext.Provider value={returnFocusRef}>
                <DrawerPrimitive.Root
                  // Vaul liest die Richtung beim Mount für Drag-Achse und Animation.
                  // Der Key baut die Instanz erst nach dem Schließen für einen inzwischen
                  // geänderten Breakpoint neu auf.
                  key={direction}
                  direction={direction}
                  shouldScaleBackground={shouldScaleBackground}
                  open={open}
                  onOpenChange={handleOpenChange}
                  dismissible={!dismissLocked}
                  {...props}
                />
              </SlideOverReturnFocusContext.Provider>
            </SlideOverOpenContext.Provider>
          </SlideOverDismissLockedContext.Provider>
        </SlideOverBusyContext.Provider>
      </SlideOverDirectionContext.Provider>
    </SheetSessionProvider>
  );
};
SlideOver.displayName = "SlideOver";

const SlideOverPortal = DrawerPrimitive.Portal;

const SlideOverOverlay = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn(
      `fixed inset-0 ${Z_LAYER.sheetBackdrop} ${FIXED_LAYER_SHIFT}`,
      OVERLAY_BACKDROP_TINT_CLASS,
      OVERLAY_BACKDROP_BLUR_CLASS,
      className,
    )}
    {...props}
  />
));
SlideOverOverlay.displayName = DrawerPrimitive.Overlay.displayName;

/**
 * Die Panelbreiten am Desktop. Ohne `size` bleibt es bei schmalen 420 px, wie
 * im Stundenplan. Es gibt bewusst keine freie Breite: `ui-kit/no-arbitrary-
 * slide-over-width` sperrt sie (#5602).
 */
const SLIDE_OVER_WIDTH = {
  md: "sm:w-[640px]",
  lg: "sm:w-[760px]",
  xl: "sm:w-[860px]",
} as const;

type SlideOverContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>,
  "size"
> & {
  /**
   * Panel width on desktop. Ignoriert, solange das Panel als Blatt von unten
   * läuft (< sm) — dort ist es immer volle Breite.
   */
  size?: keyof typeof SLIDE_OVER_WIDTH;
  /**
   * Ein Klick neben das Panel schließt es nicht. Für Formulare, deren
   * Eingaben ein Fehlklick sonst verwirft (#3370). X, Abbrechen, Escape und
   * die Wischgeste auf dem Telefon schließen weiterhin.
   */
  isBackdropDismissDisabled?: boolean;
};

function isSlideOverWidth(
  size: unknown,
): size is keyof typeof SLIDE_OVER_WIDTH {
  return typeof size === "string" && Object.hasOwn(SLIDE_OVER_WIDTH, size);
}

const SlideOverContent = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Content>,
  SlideOverContentProps
>(
  (
    {
      className,
      size,
      isBackdropDismissDisabled = false,
      onInteractOutside,
      onEscapeKeyDown,
      onOpenAutoFocus,
      onCloseAutoFocus,
      onKeyDown,
      children,
      ...props
    },
    ref,
  ) => {
    const direction = React.useContext(SlideOverDirectionContext);
    const busy = React.useContext(SlideOverBusyContext);
    const open = React.useContext(SlideOverOpenContext);
    const { isTopmost } = useOverlay(open, "sheet");
    const isSheet = direction === "bottom";
    const sheetRef = React.useRef<HTMLDivElement | null>(null);
    useSheetAboveKeyboard(sheetRef, isSheet);
    // Keeps focus in the panel while the save disables its own button.
    useBusyFocus(sheetRef, busy);
    const returnFocus = React.useContext(SlideOverReturnFocusContext);
    // Ein Blatt, das im Panel aufgeht, ersetzt es sichtbar (#8070).
    const covered = useSheetCovered(useParentSheetId());
    return (
      <SlideOverPortal>
        <SlideOverOverlay className={covered ? "app:opacity-0" : undefined} />
        <DrawerPrimitive.Content
          ref={(node: HTMLDivElement | null) => {
            sheetRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          {...SHEET_SCOPE_PROPS}
          // Focus target while a busy panel has disabled its own controls;
          // Radix sets the same on its focus scope.
          tabIndex={-1}
          aria-busy={busy || undefined}
          className={cn(
            `fixed ${Z_LAYER.sheet} ${FIXED_LAYER_SHIFT} flex flex-col bg-white shadow-2xl outline-none`,
            isSheet
              ? // Blatt von unten: an drei Kanten bündig, oben abgerundet, nie
                // höher als 90vh — der Rest der Seite bleibt als Kontext sichtbar.
                // Am iPad schwebt es als Karte wie jedes Blatt der App.
                `inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl ${SHEET_TABLET_CARD_CLASSES}`
              : // `max-w-full` fängt den einen Frame vor dem matchMedia-Effect ab:
                // ein per Deep-Link (?block=…) sofort offenes Panel würde sonst
                // kurz mit 420px auf einem schmaleren Display stehen.
                cn(
                  "top-0 right-0 h-full w-[420px] max-w-full",
                  isSlideOverWidth(size) ? SLIDE_OVER_WIDTH[size] : undefined,
                ),
            covered && "app:pointer-events-none app:invisible",
            className,
          )}
          // `dismissible={false}` an der Wurzel wäre für einen reinen
          // Hintergrundschutz zu breit: Es sperrt auch X und Escape. Radix
          // schließt bei einem Außenklick nur, solange dieses Ereignis nicht
          // abgewiesen wurde. Ein Kit-Modal über dem Panel liegt im Portal
          // außerhalb davon; ein Klick oder Fokus dort schließt das Panel
          // darunter nicht (#6148).
          onInteractOutside={(
            event: Parameters<
              NonNullable<SlideOverContentProps["onInteractOutside"]>
            >[0],
          ) => {
            onInteractOutside?.(event);
            if (isBackdropDismissDisabled || isInsideModal(event.target)) {
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={(event: KeyboardEvent) => {
            onEscapeKeyDown?.(event);
            // An overlay above the panel (dialog, tour) takes the Escape.
            // Radix handles Escape in capture, before nested controls close.
            if (
              !isTopmost() ||
              document.querySelector(
                '[role="combobox"][aria-expanded="true"], [role="listbox"], [data-date-picker-panel]',
              )
            ) {
              event.preventDefault();
            }
          }}
          // Vaul (`autoFocus` false) cancels Radix's start focus, so the
          // focus stayed on the trigger behind the panel (#7502). It goes to
          // the panel itself, the named dialog: a screen reader announces it,
          // Tab continues inside, and no field opens a phone keyboard. A field
          // the caller focuses on open keeps it; Radix then sends no event.
          onOpenAutoFocus={(event: Event) => {
            onOpenAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            sheetRef.current?.focus({ preventScroll: true });
          }}
          // The panel opens without a Radix trigger, so Radix returns the
          // focus nowhere. Back to what opened it, while that still exists
          // and the focus is not already somewhere else on the page.
          onCloseAutoFocus={(event: Event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            const state = returnFocus.current;
            const active = document.activeElement;
            const focusLost =
              active === null ||
              active === document.body ||
              sheetRef.current?.contains(active) === true;
            // Still open: Vaul's instance was rebuilt for another breakpoint.
            if (state.open) {
              event.preventDefault();
              return;
            }
            // Focus elsewhere. Inside a second panel or dialog, that one
            // suspends this panel and the opener waits for the close that
            // follows. On the page, the caller moved it on purpose: the
            // opener is done, or a later opening would return to it.
            if (!focusLost) {
              if (!active?.closest('[role="dialog"], [role="alertdialog"]')) {
                state.trigger = null;
                state.scope = null;
                state.previous = null;
              }
              event.preventDefault();
              return;
            }
            const { scope } = state;
            const target =
              findReturnTarget(state.trigger) ??
              (scope?.isConnected
                ? focusFirstOf(tabStops(scope), { preventScroll: true })
                : null) ??
              findReturnTarget(state.previous);
            state.trigger = null;
            state.scope = null;
            state.previous = null;
            // Without a target Radix keeps its own return: to a
            // `Drawer.Trigger` that opened the panel without taking focus.
            if (!target) return;
            event.preventDefault();
            focusReturnTarget(target);
          }}
          // The panel holds the start focus and is no tab stop itself, so
          // Radix's loop, which wraps from the first control, never sees
          // Shift+Tab here: the focus trap would pull it back onto the panel.
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
            onKeyDown?.(event);
            if (
              event.defaultPrevented ||
              event.key !== "Tab" ||
              !event.shiftKey ||
              event.target !== event.currentTarget
            ) {
              return;
            }
            const stops = tabStops(event.currentTarget).reverse();
            if (focusFirstOf(stops)) event.preventDefault();
          }}
          {...props}
        >
          {isSheet && (
            // Griff wie im Drawer: signalisiert die Wischgeste, mit der Vaul das
            // Blatt schließt.
            <div
              aria-hidden
              className="mx-auto mt-3 h-1 w-12 shrink-0 rounded-full bg-gray-300"
            />
          )}
          <InOverlayContext.Provider value={true}>
            {children}
          </InOverlayContext.Provider>
        </DrawerPrimitive.Content>
      </SlideOverPortal>
    );
  },
);
SlideOverContent.displayName = "SlideOverContent";

/**
 * SlideOverCloseButton — the shared close (X) control for slide-over headers.
 *
 * The SlideOver primitive (Vaul) ships no styled close button. Like every
 * overlay close X (#5531) it is the kit button `ghost` `icon` with
 * `CloseIcon`, so Modal, FormModal and SlideOver close the same way. Renders
 * the X by default; pass children to override, and aria-label to retitle it.
 */
const SlideOverCloseButton = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Close> & {
    /** What a click does (#6744); defaults to „Schließt das Seitenfenster.“ */
    readonly tooltip?: string;
  }
>(({ className, children, disabled = false, tooltip, ...props }, ref) => {
  const dismissLocked = useSlideOverDismissDisabled();
  const kitDefault = useKitDefault();
  const hint = tooltip ?? kitDefault("Schließt das Seitenfenster.");

  const close = (
    <DrawerPrimitive.Close
      ref={ref}
      type="button"
      aria-label="Schließen"
      disabled={disabled || dismissLocked}
      // Daran findet die Tour der ersten Schritte (#2832) das Schließen.
      data-overlay-close=""
      {...ICON_ONLY}
      className={buttonClassName({
        variant: "ghost",
        size: "icon",
        className: cn("shrink-0", className),
      })}
      {...props}
    >
      {children ?? <CloseIcon />}
    </DrawerPrimitive.Close>
  );
  return hint ? <ActionHint text={hint}>{close}</ActionHint> : close;
});
SlideOverCloseButton.displayName = "SlideOverCloseButton";

/**
 * The textual dismissal control for a `SlideOverFooter`. It closes through
 * Vaul and reads the same dismissal lock as the header X; save actions in the
 * footer remain independent.
 */
const SlideOverCancelButton = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Close>
>(({ className, disabled = false, ...props }, ref) => {
  const dismissLocked = useSlideOverDismissDisabled();

  return (
    <DrawerPrimitive.Close
      ref={ref}
      type="button"
      disabled={disabled || dismissLocked}
      className={buttonClassName({
        variant: "outline",
        size: "md",
        className: cn(className),
      })}
      {...props}
    />
  );
});
SlideOverCancelButton.displayName = "SlideOverCancelButton";

const DEFAULT_CLOSE = <SlideOverCloseButton />;

type SlideOverHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * The close control on the right. Defaults to `SlideOverCloseButton`; pass
   * your own for an `aria-label` or `disabled`, `false` only where the panel
   * must not be closed from here.
   */
  close?: React.ReactNode;
};

const SlideOverHeader = ({
  className,
  close = DEFAULT_CLOSE,
  children,
  ...props
}: SlideOverHeaderProps) => (
  <div
    className={cn(
      "app:border-b-0 app:px-4 app:pb-1 flex flex-row items-start justify-between gap-3 border-b border-slate-200 px-5 py-4",
      className,
    )}
    {...props}
  >
    <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    {close}
  </div>
);
SlideOverHeader.displayName = "SlideOverHeader";

type SlideOverBodyProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * The form's validation or save error. Rendered as an `Alert` at the top
   * of the body and scrolled into view when it changes. Field-level problems
   * additionally go to the field (`Input` `error`).
   */
  error?: FormErrorInput;
};

/**
 * The scrolling middle of a panel between `SlideOverHeader` and
 * `SlideOverFooter`. Carries the panel's padding and the error slot; the ref
 * reaches the scrolling element (`useApiFormError` scrolls it).
 */
const SlideOverBody = React.forwardRef<HTMLDivElement, SlideOverBodyProps>(
  ({ className, error, children, ...props }, ref) => {
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    // A body that scrolls must be reachable by keyboard, also when it holds
    // nothing focusable (axe scrollable-region-focusable, #7112).
    const scrolls = useScrollRegion(bodyRef);
    return (
      <div
        ref={(node) => {
          bodyRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling body without focusable content must be reachable by keyboard; it joins the tab order only while it scrolls
        tabIndex={scrolls ? 0 : undefined}
        className={cn(
          "app:px-4 flex-1 overflow-y-auto px-5 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gray-600",
          className,
        )}
        {...props}
      >
        <DialogErrorSlot error={error} />
        {children}
      </div>
    );
  },
);
SlideOverBody.displayName = "SlideOverBody";

/**
 * The panel's action row (`DialogActions`). It locks every action in it
 * while the panel's save runs and while a closed panel slides out (#6593).
 * A dismissal action uses `SlideOverCancelButton`; an external dismissal
 * lock (`isDismissDisabled`) leaves save and submit actions usable.
 */
const SlideOverFooter = ({
  className,
  ...props
}: React.FieldsetHTMLAttributes<HTMLFieldSetElement>) => {
  const busy = React.useContext(SlideOverBusyContext);
  const open = React.useContext(SlideOverOpenContext);
  return (
    <DialogActions
      {...props}
      locked={busy || !open}
      className={cn(
        "app:px-4 flex-row border-t border-slate-200 bg-slate-50 px-5 py-4",
        className,
        APP_FOOTER_ROW,
      )}
    />
  );
};
SlideOverFooter.displayName = "SlideOverFooter";

const SlideOverTitle = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      "app:text-base app:font-semibold text-lg leading-tight font-bold text-slate-900",
      className,
    )}
    {...props}
  />
));
SlideOverTitle.displayName = DrawerPrimitive.Title.displayName;

const SlideOverDescription = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn("text-sm text-slate-500", className)}
    {...props}
  />
));
SlideOverDescription.displayName = DrawerPrimitive.Description.displayName;

export {
  SlideOver,
  SlideOverContent,
  SlideOverHeader,
  SlideOverBody,
  SlideOverFooter,
  SlideOverTitle,
  SlideOverDescription,
  SlideOverCloseButton,
  SlideOverCancelButton,
};

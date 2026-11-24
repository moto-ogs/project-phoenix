/**
 * The browser half of the deploy-skew answer (`deployment-skew.ts`): a call
 * from a tab older than the server is refused with 412 before any route runs,
 * so nothing happened on the server. Instead of showing every open tab the
 * „neue Version“ message after each release, the tab reloads once by itself
 * on a refused read when the reload costs nothing: no form or field on screen
 * that someone typed into (a search field aside), no open dialog, no page
 * guarding unsaved changes. A refused write and every other case reach the
 * caller, whose message asks the person to reload. A marker in
 * sessionStorage (reload-once) stops a reload loop.
 */
import { isOtherDeployment } from "./deployment-skew";
import { hasNavigationBlocker } from "./hooks/navigation-guard-store";
import { reloadOnce } from "./reload-once";

const RELOAD_MARKER_KEY = "moto:deployment-skew-reload-at";

/** What can hold a draft; a field inside a form counts as its form. */
const DRAFT_FIELDS = "form, input, textarea, select, [contenteditable]";

/**
 * Forms and fields someone typed into or changed. A search field only filters
 * the page and holds no draft; an element that left the page holds none
 * either, so only elements still in the document are checked.
 */
const edited = new WeakSet<Element>();
if (typeof document !== "undefined") {
  const markDraft = ({ target }: Event) => {
    if (!(target instanceof Element)) return;
    if (target.closest('[role="search"], [data-search-field]')) return;
    if (target instanceof HTMLInputElement && target.type === "search") return;
    edited.add(target.closest("form") ?? target);
  };
  document.addEventListener("input", markDraft, true);
  document.addEventListener("change", markDraft, true);
}

/** True once this page started its reload: no refusal reaches its code. */
let reloading = false;

function hasDraftOnScreen(): boolean {
  return Array.from(document.querySelectorAll(DRAFT_FIELDS)).some((element) =>
    edited.has(element),
  );
}

function reloadLosesNothing(): boolean {
  return (
    !hasDraftOnScreen() &&
    !hasNavigationBlocker() &&
    !document.querySelector(
      '[role="dialog"], [role="alertdialog"], dialog[open]',
    )
  );
}

/**
 * Reloads the page for the proxy's refusal of a read from another deployment
 * when the reload loses nothing. Returns true when the reload started, also
 * for every further refusal of this page; the caller then leaves the answer
 * unread.
 */
export function reloadForNewDeployment(
  response: Response,
  isRead: boolean,
): boolean {
  if (typeof window === "undefined") return false;
  if (response.status !== 412 || !isOtherDeployment(response.headers)) {
    return false;
  }
  if (reloading) return true;
  // A refused write was a save the person just asked for: its edit is on
  // screen whatever the page shows of it, so the message asks them instead.
  if (!isRead || !reloadLosesNothing()) return false;
  if (!reloadOnce(RELOAD_MARKER_KEY)) return false;
  reloading = true;
  return true;
}

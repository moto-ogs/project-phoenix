/**
 * The browser half of the deploy-skew answer (`deployment-skew.ts`): a call
 * from a tab older than the server is refused with 412 before any route runs,
 * so nothing happened on the server. Instead of showing every open tab the
 * „neue Version“ message after each release, the tab reloads once by itself
 * when the reload costs nothing: no form on screen that someone typed into,
 * no open dialog, no page guarding unsaved changes. Otherwise the refusal
 * reaches the caller and its message asks the person to reload. A marker in
 * sessionStorage (reload-once) stops a reload loop.
 */
import { isOtherDeployment } from "./deployment-skew";
import { hasNavigationBlocker } from "./hooks/navigation-guard-store";
import { reloadOnce } from "./reload-once";

const RELOAD_MARKER_KEY = "moto:deployment-skew-reload-at";

/** Forms someone typed into; a form that left the page holds no draft. */
const editedForms = new Set<HTMLFormElement>();
if (typeof document !== "undefined") {
  const markDraft = (event: Event) => {
    const form =
      event.target instanceof Element ? event.target.closest("form") : null;
    if (form) editedForms.add(form);
  };
  document.addEventListener("input", markDraft, true);
  document.addEventListener("change", markDraft, true);
}

/** True once this page started its reload: no refusal reaches its code. */
let reloading = false;

function hasDraftOnScreen(): boolean {
  for (const form of editedForms) {
    if (form.isConnected) return true;
    editedForms.delete(form);
  }
  return false;
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
 * Reloads the page for the proxy's refusal of a call from another deployment
 * when the reload loses nothing. Returns true when the reload started, also
 * for every further refusal of this page; the caller then leaves the answer
 * unread.
 */
export function reloadForNewDeployment(response: Response): boolean {
  if (typeof window === "undefined") return false;
  if (response.status !== 412 || !isOtherDeployment(response.headers)) {
    return false;
  }
  if (reloading) return true;
  if (!reloadLosesNothing() || !reloadOnce(RELOAD_MARKER_KEY)) return false;
  reloading = true;
  return true;
}

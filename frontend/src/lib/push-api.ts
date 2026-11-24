import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as sharedContract from "./contract/shared.generated";
/**
 * Web Push client (#2003): service worker registration, permission +
 * subscription lifecycle, and the proxy-route calls that persist the
 * subscription on the backend.
 *
 * Portal awareness: the staff app talks to /api/notifications/push/*, the
 * parents portal to /api/parent/me/push/*. Both portals are separate origins,
 * so their service workers and push endpoints never collide.
 */

export type PushPortal = "tenant" | "parent" | "school";

/** Identifies the expected backend response when VAPID is not configured. */
export function isPushConfigurationMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** True when this browser can register for Web Push at all. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** True when the app runs installed (home screen / standalone mode). */
export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS Safari exposes the legacy navigator.standalone flag.
  return (
    "standalone" in window.navigator &&
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** True on iOS/iPadOS until the app is running from the home screen. */
export function needsIOSInstall(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isAppleMobile =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as macOS but has touch support.
    (ua.includes("Macintosh") && window.navigator.maxTouchPoints > 1);
  return isAppleMobile && !isStandaloneApp();
}

const PUSH_FAILED = "Push-Anfrage fehlgeschlagen.";

function loadPublicKey(
  portal: PushPortal,
): Promise<sharedContract.pushPublicKeyResponse> {
  const options = { errorMessage: PUSH_FAILED };
  switch (portal) {
    case "parent":
      return bffJson("parent", "GET /parent/me/push/public-key", options);
    case "school":
      return bffJson(
        "school",
        "GET /school/notifications/push/public-key",
        options,
      );
    default:
      return bffJson(
        "tenant",
        "GET /api/notifications/push/public-key",
        options,
      );
  }
}

/** The server's uncompressed P-256 VAPID public key. */
export type PushPublicKey = Uint8Array<ArrayBuffer>;

/** The failure of a push action on a server without Web Push. */
export function pushConfigurationMissing(): ApiError {
  return new ApiError(
    "Web Push ist auf diesem Server nicht eingerichtet.",
    404,
  );
}

/**
 * Fetches and validates the server's VAPID public key. `null` is the valid
 * answer of a server without Web Push. Read it through `usePushPublicKey`,
 * so every reader of a page shares one request.
 */
export async function fetchPushPublicKey(
  portal: PushPortal,
): Promise<PushPublicKey | null> {
  let response: sharedContract.pushPublicKeyResponse;
  try {
    response = await loadPublicKey(portal);
  } catch (error) {
    if (isPushConfigurationMissing(error)) return null;
    throw error;
  }
  const key = response.public_key;
  if (!key) return null;
  try {
    const decoded = urlBase64ToUint8Array(key);
    if (decoded.length !== 65 || decoded[0] !== 4) {
      throw new Error("invalid P-256 public key");
    }
    return decoded;
  } catch {
    throw new ApiError("Der Web-Push-Schlüssel des Servers ist ungültig.", 502);
  }
}

/** Registers /sw.js (idempotent) and returns the registration. */
async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return registration;
}

/** Returns the current browser push subscription, if any. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Subscribes this device: requests permission (must be called from a user
 * gesture), creates the browser subscription, and persists it server-side.
 */
export async function subscribePush(
  portal: PushPortal,
  loadPublicKey: () => Promise<PushPublicKey>,
): Promise<void> {
  // Invoke permission directly in the click path so Safari preserves the
  // transient user activation while the key is read.
  const permissionPromise = Notification.requestPermission();
  const publicKeyPromise = loadPublicKey();
  const [permission, publicKey] = await Promise.all([
    permissionPromise,
    publicKeyPromise,
  ]);
  if (permission !== "granted") {
    throw new ApiError("Benachrichtigungen wurden nicht erlaubt.", 403);
  }

  const registration = await registerPushServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing && applicationServerKeyMatches(existing, publicKey)
      ? existing
      : await replaceBrowserSubscription(registration, existing, publicKey);

  await syncSubscription(portal, subscription);
}

async function replaceBrowserSubscription(
  registration: ServiceWorkerRegistration,
  existing: PushSubscription | null,
  publicKey: PushPublicKey,
): Promise<PushSubscription> {
  if (existing) {
    const removed = await existing.unsubscribe();
    if (!removed) {
      throw new ApiError(
        "Die bestehende Push-Registrierung konnte nicht erneuert werden.",
        409,
      );
    }
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: publicKey,
  });
}

function applicationServerKeyMatches(
  subscription: PushSubscription,
  expected: Uint8Array<ArrayBuffer>,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

/** Persists an existing browser subscription server-side (e.g. re-sync). */
async function syncSubscription(
  portal: PushPortal,
  subscription: PushSubscription,
): Promise<void> {
  const { endpoint, keys } = subscription.toJSON();
  const options = {
    body: {
      endpoint,
      keys: { p256dh: keys?.p256dh, auth: keys?.auth },
    },
    errorMessage: PUSH_FAILED,
  };
  switch (portal) {
    case "parent":
      await bffJson("parent", "POST /parent/me/push/subscriptions", options);
      return;
    case "school":
      await bffJson(
        "school",
        "POST /school/notifications/push/subscriptions",
        options,
      );
      return;
    default:
      await bffJson(
        "tenant",
        "POST /api/notifications/push/subscriptions",
        options,
      );
  }
}

/**
 * Removes this device's server-side registration. With a live session it is
 * the portal's call, its 401 handling included. During a logout the session
 * family is already revoked and the sign-out must stay the last cookie
 * change, so the call goes out plain: no session gate, no renewal, no login
 * redirect.
 */
async function deleteServerSubscription(
  portal: PushPortal,
  endpoint: string,
  signal: AbortSignal | undefined,
  duringLogout: boolean,
): Promise<void> {
  const options = {
    query: { endpoint },
    ...(signal ? { signal } : {}),
    errorMessage: PUSH_FAILED,
    skipAuthRecovery: duringLogout,
  };
  switch (portal) {
    case "parent":
      await bffJson("parent", "DELETE /parent/me/push/subscriptions", options);
      return;
    case "school":
      await bffJson(
        "school",
        "DELETE /school/notifications/push/subscriptions",
        options,
      );
      return;
    case "tenant":
      await bffJson(
        "tenant",
        "DELETE /api/notifications/push/subscriptions",
        options,
      );
  }
}

/**
 * Rebinds an existing browser subscription to the authenticated account.
 * It never requests permission or creates a first subscription.
 */
export async function syncExistingPushSubscription(
  portal: PushPortal,
  publicKey: PushPublicKey,
): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await registerPushServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return null;

  const subscription = applicationServerKeyMatches(existing, publicKey)
    ? existing
    : await replaceBrowserSubscription(registration, existing, publicKey);
  await syncSubscription(portal, subscription);
  return subscription;
}

/**
 * Unsubscribes this device: removes the server-side registration and the
 * browser subscription. Best effort — errors surface to the caller.
 */
export async function unsubscribePush(
  portal: PushPortal,
  signal?: AbortSignal,
  duringLogout = false,
): Promise<void> {
  signal?.throwIfAborted();
  const subscription = await getExistingSubscription();
  signal?.throwIfAborted();
  if (!subscription) return;
  if (duringLogout) {
    // Revocation already removed the server registration. Start device
    // cleanup now: sign-out can cancel the DELETE while waiting for headers.
    await Promise.all([
      deleteServerSubscription(portal, subscription.endpoint, signal, true),
      subscription.unsubscribe(),
    ]);
    return;
  }
  try {
    await deleteServerSubscription(
      portal,
      subscription.endpoint,
      signal,
      false,
    );
  } finally {
    if (!signal?.aborted) await subscription.unsubscribe();
  }
}

/**
 * Best-effort unsubscribe for logout flows: never throws, so a push cleanup
 * failure can never block logging out.
 */
export async function unsubscribePushSilently(
  portal: PushPortal,
  deadline?: { signal: AbortSignal; timeoutMs: number },
): Promise<void> {
  if (deadline?.signal.aborted) return;
  const controller = deadline ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (!deadline || !controller) {
      await unsubscribePush(portal, undefined, true);
      return;
    }
    const ended = new Promise<void>((resolve) => {
      abort = () => {
        controller.abort();
        resolve();
      };
      deadline.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, deadline.timeoutMs);
    });
    // Browser Push APIs cannot be aborted. Stop waiting for them too, while
    // unsubscribePush's signal guards prevent their late continuations.
    await Promise.race([
      unsubscribePush(portal, controller.signal, true),
      ended,
    ]);
  } catch {
    // A server row left behind after browser cleanup is pruned on 404/410.
  } finally {
    clearTimeout(timer);
    if (deadline && abort) deadline.signal.removeEventListener("abort", abort);
  }
}

/** Converts a URL-safe base64 VAPID key to the byte array subscribe() needs. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.codePointAt(i) as number;
  }
  return outputArray;
}

import "server-only";
import { createHmac } from "node:crypto";
import { env } from "~/env";

/**
 * The account's pseudonym for Sentry (#3843): an HMAC-SHA256 of the account
 * ID under the Auth.js secret, 128 bits as hex. Errors of one account still
 * group, but without the server secret no one can map it back to the ID;
 * an unkeyed hash of a short numeric ID could be reversed by trying every
 * ID. The label separates it from the secret's other uses (session cookie,
 * refresh recovery proof). Rotating the secret starts new pseudonyms.
 */
export function sentryUserPseudonym(
  accountId: string | undefined,
): string | undefined {
  if (!accountId) return undefined;
  return createHmac("sha256", env.NEXTAUTH_SECRET)
    .update("moto-sentry-user-v1\0")
    .update(accountId)
    .digest("hex")
    .slice(0, 32);
}

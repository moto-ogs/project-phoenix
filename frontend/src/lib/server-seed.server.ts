import type { z } from "zod";
import {
  contractGet,
  type ContractOptions,
} from "~/lib/contract/client.server";
import { createLogger } from "~/lib/logger";
import { sessionGeneration } from "~/lib/swr/session-generation";
import type { PortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import type { ServerSeed, ServerSeedEntry } from "~/lib/swr/server-seed";

/**
 * Upper bound per backend call of a server preload (#2973, #8077). A page or
 * shell must never hang on one slow read: past the budget the value stays
 * undefined and the browser fetches it as it always did.
 */
const REQUEST_BUDGET_MS = 1500;

/** What a budgeted load reports instead of throwing. */
export interface BudgetReport {
  timeout(): void;
  failed(error: unknown): void;
}

/**
 * Resolves to the loaded value, or undefined when the request failed or ran
 * out of budget. The request is aborted at the budget. Never rejects.
 */
export async function withRequestBudget<T>(
  load: (signal: AbortSignal) => Promise<T>,
  report: BudgetReport,
): Promise<T | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      report.timeout();
      controller.abort();
      resolve(undefined);
    }, REQUEST_BUDGET_MS);
  });
  try {
    return await Promise.race([load(controller.signal), timeout]);
  } catch (error) {
    report.failed(error);
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A registered GET through its generated decoder. A refusal, a 5xx or an
 * answer that does not match the contract throws.
 */
export async function readContract<
  R extends { method: "GET"; pattern: string; response: z.ZodType },
>(
  route: R,
  ...options: ContractOptions<NoInfer<R>>
): Promise<z.output<R["response"]>> {
  const result = await contractGet(route, ...options);
  if (!result.ok) throw result.error.cause;
  return result.value;
}

const logger = createLogger({ component: "PageSeed" });

/**
 * One page read under the budget: undefined on timeout, refusal, 5xx or an
 * answer the decoder rejects. Logs the route name only, never data.
 */
export function seedRead<T>(
  name: string,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  return withRequestBudget(load, {
    timeout: () => logger.warn("page_seed_timeout", { field: name }),
    failed: (error) =>
      logger.debug("page_seed_skipped", {
        field: name,
        error: error instanceof Error ? error.message : String(error),
      }),
  });
}

/**
 * The seed of a snapshot, or null when the snapshot cannot carry personal
 * data: missing, ended, or its school has not booked the portal's module.
 */
export function seedOf(
  snapshot: PortalSessionSnapshot | null,
  entries: readonly ServerSeedEntry[],
  builtAt: number,
): ServerSeed | null {
  if (!snapshot?.accessToken || snapshot.notBooked) return null;
  const generation = sessionGeneration(snapshot.session);
  if (generation === null) return null;
  return { builtAt, generation, entries };
}

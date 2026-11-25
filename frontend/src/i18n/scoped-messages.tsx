import type { ReactNode } from "react";
import {
  NextIntlClientProvider,
  type AbstractIntlMessages,
  type NestedKeyOf,
} from "next-intl";
import { getMessages } from "next-intl/server";
import type de from "./messages/de.generated";

type MessagePath = Exclude<NestedKeyOf<typeof de>, "errorCatalog">;

/** Select from the request catalog *after* next-intl's German fallback has been applied. */
function selectMessages(
  catalog: AbstractIntlMessages,
  paths: readonly MessagePath[],
): AbstractIntlMessages {
  const selected: AbstractIntlMessages = {};
  function copy(
    source: AbstractIntlMessages,
    target: AbstractIntlMessages,
    [key, ...rest]: string[],
  ) {
    if (!key || source[key] === undefined)
      throw new Error(`Missing catalog path: ${paths.join(", ")}`);
    const value = source[key];
    if (rest.length === 0) {
      target[key] = value;
    } else {
      if (typeof value === "string")
        throw new Error(`Expected a message namespace: ${key}`);
      const branch: AbstractIntlMessages =
        (target[key] as AbstractIntlMessages | undefined) ?? {};
      target[key] = branch;
      copy(value, branch, rest);
    }
  }
  for (const path of paths) copy(catalog, selected, path.split("."));
  return selected;
}

/** A server boundary. A nested next-intl provider replaces, rather than merges,
 * its parent's messages, so each list includes the shared controls it renders. */
export function messageBoundary(...paths: MessagePath[]) {
  return async function ScopedMessages({
    children,
  }: Readonly<{ children: ReactNode }>) {
    const messages = selectMessages(await getMessages(), paths);
    return (
      <NextIntlClientProvider messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

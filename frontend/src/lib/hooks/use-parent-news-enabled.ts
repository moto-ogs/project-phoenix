"use client";

import { useSession } from "next-auth/react";
import { useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import { listAnnouncements } from "~/lib/parent-api";
import {
  useParentChildren,
  useParentFeatures,
  PARENT_RESOURCE_OPTIONS,
} from "./use-parent-resources";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

export function useParentNewsEnabled(
  enabled: boolean,
  children?: readonly parentMeContract.ChildResponse[] | null,
): boolean {
  const { data: session } = useSession();
  const parentEnabled = enabled && session?.user.scope === "parent";
  const linked = useParentChildren(parentEnabled && children === undefined);
  const features = useParentFeatures(
    parentEnabled ? (children ?? linked.data) : undefined,
  );
  // Enrollment-only parents can receive news without a linked child.
  const feedAvailable = useSWRAuth(
    parentEnabled ? parentKeys.newsAvailable() : null,
    async () => (await listAnnouncements()).length > 0,
    PARENT_RESOURCE_OPTIONS,
  );
  return (
    feedAvailable.data === true ||
    Object.values(features.data ?? {}).some(
      (f) => f.parent_news_enabled === true,
    )
  );
}

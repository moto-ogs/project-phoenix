"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Child } from "~/lib/parent-api";

import {
  useParentChildren,
  useParentFeatures,
} from "~/lib/hooks/use-parent-resources";

const SharedFeaturesContext = createContext<ReturnType<
  typeof useParentFeatures
> | null>(null);

export function SharedParentFeaturesProvider({
  children,
  linkedChildren,
}: Readonly<{
  children: ReactNode;
  linkedChildren: readonly Child[] | undefined;
}>) {
  const resource = useParentFeatures(linkedChildren);
  return (
    <SharedFeaturesContext.Provider value={resource}>
      {children}
    </SharedFeaturesContext.Provider>
  );
}

export function useSharedParentFeatures() {
  return useContext(SharedFeaturesContext);
}

/**
 * The feature flags of one child: the page-wide reader when the page provides
 * one, otherwise the shared reader of the account's children.
 */
export function useChildFeatures(studentId: string, enabled = true) {
  const shared = useSharedParentFeatures();
  const children = useParentChildren(enabled && shared === null);
  const own = useParentFeatures(
    enabled && shared === null ? children.data : undefined,
  );
  const resource = shared ?? own;
  const features = resource.data?.[studentId];
  const failure =
    resource.errorsByChild[studentId] ??
    (!features ? (resource.error ?? children.error) : undefined);
  return {
    features,
    failure: enabled ? failure : undefined,
    loading: enabled && !features && !failure,
    reload: resource.mutate,
  };
}

"use client";

import { useSession } from "next-auth/react";

import {
  canReviewChangeRequests,
  resolveChangeRequestAccess,
  type ParentRequestReviewAccess,
} from "~/lib/change-request-access";
import { fetchChangeRequestAccess } from "~/lib/change-requests-api";
import { hasEffectiveAdminScope } from "~/lib/auth-utils";
import { useShellAuth } from "~/lib/shell-auth-context";
import { isReadRefusal } from "~/lib/access-refusal";
import { useSWRAuth } from "~/lib/swr";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useRefusalGuard } from "./use-confirmed-resource";

/**
 * Verbindet die langlebigen JWT-Rechte mit dem aktuellen serverseitigen
 * Prüfbereich. Gruppenleitungen und Vertretungen können sich während einer
 * Sitzung ändern; deshalb darf das JWT allein das Anfragen-Modul nicht öffnen.
 */
export function useChangeRequestAccess() {
  const { data: session, status } = useSession();
  const { mode } = useShellAuth();
  const admin = hasEffectiveAdminScope(session);
  const accountId = session?.user.id;
  const needsParentReviewAccess =
    status === "authenticated" &&
    mode === "teacher" &&
    !admin &&
    canReviewChangeRequests(session);

  const accessKey =
    needsParentReviewAccess && accountId
      ? shellResourceKeys.changeRequestAccess(accountId)
      : null;
  const { data, error, isLoading, mutate } =
    useSWRAuth<ParentRequestReviewAccess>(accessKey, fetchChangeRequestAccess, {
      keepPreviousData: false,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    });

  // A refusal in force is an answer too, also when a later check failed
  // otherwise (useSWRAuth then reports the newer failure).
  const { refusal } = useRefusalGuard(accessKey);
  const access = resolveChangeRequestAccess(
    session,
    admin ? "admin" : (data ?? "none"),
  );

  return {
    ...access,
    /**
     * Whether the server answered the review-area check, a refusal included,
     * or none is needed (#8268).
     */
    settled:
      !needsParentReviewAccess ||
      data !== undefined ||
      refusal !== undefined ||
      isReadRefusal(error),
    isLoading:
      status === "loading" ||
      (needsParentReviewAccess &&
        data === undefined &&
        error === undefined &&
        isLoading),
    error,
    refresh: mutate,
  };
}

"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAccessControlledData } from "~/lib/hooks/use-access-controlled-data";
// eslint-disable-next-line no-restricted-imports -- operator reads have no school session
import { useSWRAuth, useTenantMutateMatching } from "~/lib/swr";
import { useScopedSWRKey, useSWRRequestGuard } from "~/lib/swr/hooks";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";
import {
  defaultAccountSort,
  type AccountPage,
  type AccountScope,
  type AccountSort,
} from "./account-pages";
import { operatorProvisioningService } from "./provisioning-api";

interface Continuation {
  scopeKey: string;
  first: AccountPage;
  pages: AccountPage[];
  loading: boolean;
  error?: unknown;
}

export function useOperatorAccountPages(
  scope: AccountScope,
  enabled: boolean,
  search = "",
) {
  const scopeId =
    scope.kind === "all" ? scope.kind : `${scope.kind}:${scope.id}`;
  const [selection, setSelection] = useState<{
    scopeId: string;
    sort: AccountSort;
  }>();
  const sort =
    selection?.scopeId === scopeId ? selection.sort : defaultAccountSort(scope);
  const query = {
    sort: sort.key,
    direction: sort.direction,
    search: search.trim(),
  };
  const key = operatorProvisioningKeys.accountPage(scope, query);
  const scopedKey = useScopedSWRKey(key);
  const beginRead = useSWRRequestGuard();
  const refreshFamily = useTenantMutateMatching(
    operatorProvisioningKeys.accountFamilies,
  );
  const [continuation, setContinuation] = useState<Continuation>();
  const request = useRef<symbol | null>(null);

  const first = useSWRAuth(
    enabled ? key : null,
    () => operatorProvisioningService.listAccountPage(scope, query),
    {
      keepPreviousData: false,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );

  useLayoutEffect(() => {
    request.current = null;
    setContinuation(undefined);
    return () => {
      request.current = null;
    };
  }, [enabled, scopedKey, first.data]);

  const current =
    enabled &&
    continuation?.scopeKey === scopedKey &&
    continuation?.first === first.data
      ? continuation
      : undefined;
  const error = first.error ?? current?.error;
  const { data, accessRefused } = useAccessControlledData(
    enabled ? key : null,
    first.data,
    error,
  );
  const last = data && (current?.pages.at(-1) ?? data);
  const rows =
    data && [data, ...(current?.pages ?? [])].flatMap((page) => page.rows);
  const cursor = last?.cursor;

  const refresh = useCallback(async () => {
    request.current = null;
    setContinuation(undefined);
    // Clear other order/filter keys as well; their first page may contain a
    // row whose position or visibility changed during the write.
    await refreshFamily();
  }, [refreshFamily]);

  const loadMore = async () => {
    if (request.current || !scopedKey || !data || !cursor || accessRefused)
      return;
    const id = Symbol();
    request.current = id;
    const pending = {
      scopeKey: scopedKey,
      first: data,
      pages: current?.pages ?? [],
      loading: true,
    };
    setContinuation(pending);
    let guard: ReturnType<typeof beginRead> | undefined;
    const finish = (next: Continuation) => {
      if (request.current === id) {
        setContinuation(guard?.isCurrent() ? next : undefined);
      }
    };
    try {
      guard = beginRead(key);
      const page = await operatorProvisioningService.listAccountPage(scope, {
        ...query,
        cursor,
      });
      finish({ ...pending, pages: [...pending.pages, page], loading: false });
    } catch (error) {
      finish({ ...pending, loading: false, error });
    } finally {
      if (request.current === id) request.current = null;
    }
  };

  return {
    rows,
    total: last?.total,
    error,
    isLoading: first.isLoading,
    accessRefused,
    refresh,
    serverSort: {
      ...sort,
      onChange: (next: AccountSort) => {
        request.current = null;
        setContinuation(undefined);
        setSelection({ scopeId, sort: next });
      },
    },
    moreAction:
      cursor && !accessRefused
        ? {
            label: "Mehr laden",
            onClick: () => void loadMore(),
            loading: current?.loading,
          }
        : undefined,
  };
}

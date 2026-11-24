"use client";

// Nummernkreise der Stellen, die eine Schule selbst abrechnen (#8040, ADR
// 0321): ein Schulträger oder eine Gemeinde mit Gläubiger-ID und Konto
// vergibt eigene Nummern, je Leistung. Ohne Muster gibt moto keinen Lauf
// mit ihren Rechnungen frei. Rechnet nur der Träger ab, zeigt die Seite
// hier nichts.

import { useCallback } from "react";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchBillingIssuerStatuses } from "~/lib/traeger-billing-issuers-api";
import {
  emptyNumberRange,
  fetchIssuerNumberRanges,
} from "~/lib/traeger-billing-api";
import { NumberRangeCard } from "./number-range-card";
import { useTraegerResource } from "./use-traeger-resource";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";

export function IssuerNumberRangeCards() {
  const invalidateFamily = useInvalidateFamily();
  const issuers = useTraegerResource(
    traegerKeys.billingIssuers(),
    fetchBillingIssuerStatuses,
    "die Liste der Stellen, die selbst abrechnen",
  );
  const ranges = useTraegerResource(
    issuers.data && issuers.data.length > 0
      ? traegerKeys.issuerNumberRanges()
      : null,
    fetchIssuerNumberRanges,
    "die Nummernkreise der Stellen",
  );
  const reloadRanges = ranges.reload;
  const reloadIssuers = issuers.reload;
  const onChanged = useCallback(async () => {
    void invalidateFamily(traegerKeys.requiredDetails());
    await Promise.all([reloadRanges(), reloadIssuers()]);
  }, [invalidateFamily, reloadRanges, reloadIssuers]);

  const error = issuers.error ?? ranges.error;
  if (error) return <LoadErrorAlert error={error} />;
  if (!issuers.data || issuers.data.length === 0 || !ranges.data) return null;
  return (
    <>
      {issuers.data.flatMap((status) =>
        (["holiday", "care"] as const).map((service) => (
          <NumberRangeCard
            key={`${status.issuer.key}-${service}`}
            service={service}
            issuer={status.issuer}
            numberRange={
              ranges.data?.get(status.issuer.key)?.[service] ??
              emptyNumberRange(service)
            }
            onChanged={onChanged}
          />
        )),
      )}
    </>
  );
}

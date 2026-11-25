"use client";

import { initialAccountQuery } from "~/lib/operator/account-pages";
import type { ReactNode } from "react";
import type { OrganizationSummary } from "~/lib/operator/provisioning-helpers";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

const SUMMARIES_KEY = operatorProvisioningKeys.organizationSummaries();
const CLAIMS = [SUMMARIES_KEY];

export function OrganizationSeed({
  seed,
  slug,
  tab,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  slug: string;
  tab: "geraete" | "loeschauftrag" | "konten" | null;
  children: ReactNode;
}>) {
  return (
    <SWRServerSeed
      seed={seed}
      claims={CLAIMS}
      claimsFrom={
        tab
          ? {
              key: SUMMARIES_KEY,
              derive: (summaries: readonly OrganizationSummary[]) => {
                const id = summaries.find((entry) => entry.slug === slug)?.id;
                if (id && tab === "konten") {
                  const scope = { kind: "organization", id } as const;
                  return [
                    operatorProvisioningKeys.accountPage(
                      scope,
                      initialAccountQuery(scope),
                    ),
                  ];
                }
                return id
                  ? [
                      tab === "geraete"
                        ? operatorProvisioningKeys.orgDevices(id)
                        : operatorProvisioningKeys.orgErasureOrder(id),
                    ]
                  : [];
              },
            }
          : undefined
      }
      render
    >
      {children}
    </SWRServerSeed>
  );
}

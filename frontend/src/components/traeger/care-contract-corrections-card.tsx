// Die nachgepflegten Angaben eines importierten Vertrags (#7767): je
// Änderung der Tag, die geänderten Werte als „alt → neu“, der Beleg und die
// Datei. Nur zur Information; geändert wird über „Vertragsangaben
// nachpflegen“.

import { DataField, DataGrid } from "~/components/ui/data-field";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { formatDate } from "~/lib/date-helpers";
import type { ContractCorrectionRecord } from "~/lib/traeger-care-contracts-api";
import { CorrectionChangeFields } from "./care-contract-correction-value";

export function CareContractCorrectionsCard({
  corrections,
}: Readonly<{ corrections: readonly ContractCorrectionRecord[] }>) {
  // Newest first: the values at the top are the ones the contract has now.
  const sorted = [...corrections].sort((a, b) =>
    b.correctedAt.localeCompare(a.correctedAt),
  );
  return (
    <SectionCard
      title="Nachgepflegte Angaben"
      description="Diese Angaben stammen aus den Originalunterlagen. Der Import kannte sie nicht."
    >
      <div className="divide-y divide-gray-100">
        {sorted.map((correction) => (
          <section
            key={`${correction.correctedAt}|${correction.file}`}
            className="py-4 first:pt-0 last:pb-0"
          >
            <SectionLabel as="h3">
              {`Nachgepflegt am ${formatDate(correction.correctedAt)}`}
            </SectionLabel>
            <div className="mt-2">
              <DataGrid>
                <CorrectionChangeFields
                  changes={correction.changes}
                  before={correction.before}
                  after={correction.after}
                />
                <DataField label="Beleg">
                  <span className="wrap-anywhere">
                    {correction.evidence || "–"}
                  </span>
                </DataField>
                <DataField label="Datei">
                  <span className="wrap-anywhere">
                    {correction.file || "–"}
                  </span>
                </DataField>
              </DataGrid>
            </div>
          </section>
        ))}
      </div>
    </SectionCard>
  );
}

"use client";

// Die Reiter der Vertragsseite (#7408) und die Sprungknöpfe zu ihren Karten.
// Ein Hinweis über den Reitern oder eine Karte in einem anderen Reiter nennt
// eine Karte: der Knopf öffnet erst ihren Reiter, dann springt er hin.

import { createContext, type ReactNode, useContext } from "react";
import { JumpButton } from "~/components/ui/jump-button";

export type ContractDetailTab =
  "vertrag" | "versand" | "kuendigung" | "versionen";

export const CONTRACT_DETAIL_TABS: readonly {
  readonly value: ContractDetailTab;
  readonly label: string;
}[] = [
  { value: "vertrag", label: "Vertrag" },
  { value: "versand", label: "Unterschrift und Versand" },
  { value: "kuendigung", label: "Kündigung" },
  { value: "versionen", label: "Versionen" },
];

/** The tab in the address; an unknown value opens the first tab. */
export function parseContractDetailTab(
  value: string | null | undefined,
): ContractDetailTab {
  return (
    CONTRACT_DETAIL_TABS.find((tab) => tab.value === value)?.value ?? "vertrag"
  );
}

/** The card „Versand“, where notices about the mail lead (#7054). */
export const CONTRACT_DELIVERY_SECTION_ID = "vertrag-versand";
/** The card „Vertrag beenden“. */
export const CONTRACT_NOTICE_SECTION_ID = "vertrag-beenden";
/** The card „Versionen“. */
export const CONTRACT_VERSIONS_SECTION_ID = "vertrag-versionen";
/** The card „Geänderte Fassung“ of a change that waits (#4816). */
export const CONTRACT_CHANGE_SECTION_ID = "vertrag-geaenderte-fassung";

type ContractSectionId =
  | typeof CONTRACT_CHANGE_SECTION_ID
  | typeof CONTRACT_DELIVERY_SECTION_ID
  | typeof CONTRACT_NOTICE_SECTION_ID
  | typeof CONTRACT_VERSIONS_SECTION_ID;

const SECTION_TABS: Record<ContractSectionId, ContractDetailTab> = {
  [CONTRACT_CHANGE_SECTION_ID]: "versand",
  [CONTRACT_DELIVERY_SECTION_ID]: "versand",
  [CONTRACT_NOTICE_SECTION_ID]: "kuendigung",
  [CONTRACT_VERSIONS_SECTION_ID]: "versionen",
};

/** Opens a tab of the contract page; outside the page nothing happens. */
const OpenTabContext = createContext<(tab: ContractDetailTab) => void>(
  () => undefined,
);

export function ContractDetailTabsProvider({
  openTab,
  children,
}: Readonly<{
  openTab: (tab: ContractDetailTab) => void;
  children: ReactNode;
}>) {
  return <OpenTabContext value={openTab}>{children}</OpenTabContext>;
}

/** A `JumpButton` to a card of the contract page, also in another tab. */
export function ContractSectionJump({
  targetId,
  tooltip,
  children,
}: Readonly<{
  targetId: ContractSectionId;
  tooltip: string;
  children: ReactNode;
}>) {
  const openTab = useContext(OpenTabContext);
  return (
    <JumpButton
      targetId={targetId}
      tooltip={tooltip}
      reveal={() => openTab(SECTION_TABS[targetId])}
    >
      {children}
    </JumpButton>
  );
}

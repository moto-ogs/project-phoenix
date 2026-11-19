"use client";

import { TenantPage } from "~/components/ui/tenant-page";
import { StaffCardsSkeleton } from "./page-skeleton";

export default function StaffLoading() {
  return (
    // Titel und Suchfeld sind fest und rendern sofort im echten Gerüst; nur
    // die Statuszeile und die Kartenliste darunter skelettieren.
    <TenantPage
      title="Mitarbeitende"
      statsLoading
      search={{
        value: "",
        onChange: () => {},
        placeholder: "Mitarbeitende suchen…",
        inputProps: { disabled: true },
      }}
    >
      <StaffCardsSkeleton />
    </TenantPage>
  );
}

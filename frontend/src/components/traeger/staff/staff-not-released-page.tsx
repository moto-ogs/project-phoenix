"use client";

// Personal beim Träger, solange das moto-Team es nicht freigeschaltet hat
// (#4705, ADR 0089): Jede Seite des Bereichs zeigt dann die Bauart
// „Funktion nicht eingeschaltet“ (#7415). Die Seite nennt, was bis dahin
// gilt; wer freischaltet und unter welcher Bedingung, ist überall gleich.

import { FeatureOffPage } from "~/components/ui/feature-off-page";
import type { TenantPageProps } from "~/components/ui/tenant-page";

/** Wer freischaltet und wann: die Bedingung aus ADR 0089. */
const STAFF_RELEASE_CONDITION =
  "Das moto-Team schaltet Personal beim Träger frei, sobald dein Träger bestätigt hat: Es gibt eine Vereinbarung mit Betriebsrat oder Mitarbeitervertretung, oder es gibt keine Vertretung.";

export function StaffNotReleasedPage({
  title,
  description,
  back,
  backHref,
  backLabel,
}: Readonly<{
  /** Der Seitentitel, derselbe wie freigeschaltet. */
  title: string;
  /** Was bis zur Freischaltung gilt, ein Satz für diese Seite. */
  description: string;
  /** Rückweg einer gesperrten Unterseite zu den Personalakten. */
  back?: TenantPageProps["back"];
  backHref?: TenantPageProps["backHref"];
  backLabel?: TenantPageProps["backLabel"];
}>) {
  return (
    <FeatureOffPage
      title={title}
      description={description}
      whoCanEnable={STAFF_RELEASE_CONDITION}
      back={back}
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}

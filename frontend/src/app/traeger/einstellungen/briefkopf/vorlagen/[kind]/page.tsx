import { isDocumentTemplateKind } from "~/lib/traeger-document-templates";
import { documentTemplate } from "~/lib/traeger/administration-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerVorlagePage from "./page-content";

export default async function Page({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  const { seed, claims } = traegerPageSeed(
    isDocumentTemplateKind(kind) ? [documentTemplate(kind)] : [],
  );
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerVorlagePage />
      </SWRServerSeed>
    </Suspense>
  );
}

import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  operatorPageSeed,
  organizations,
} from "~/lib/operator/page-seed.server";

export default function PageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { seed, claims } = operatorPageSeed([organizations]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        {children}
      </SWRServerSeed>
    </Suspense>
  );
}

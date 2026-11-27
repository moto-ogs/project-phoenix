import { connection } from "next/server";
import type { ReactNode } from "react";
import { ParentServerSeed } from "~/components/parent/parent-server-seed";
import type { ParentSeedPage } from "~/lib/parent-page-seed-keys";
import { parentSeedProps } from "~/lib/parent-seed.server";

/** A first-display seed, under the route's existing loading boundary. */
export async function ParentPageSeed({
  page,
  children,
}: Readonly<{ page: ParentSeedPage; children: ReactNode }>) {
  await connection();
  // Don't hold a conversation opening on the optional composer seed:
  // the existing reader has to mark the opened thread read.
  const render = page.kind !== "conversation" && page.kind !== "groupThread";
  return (
    <ParentServerSeed {...parentSeedProps(render, page)} page={page}>
      {children}
    </ParentServerSeed>
  );
}

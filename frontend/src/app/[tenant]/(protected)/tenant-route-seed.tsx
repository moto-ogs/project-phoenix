import type { ReactNode } from "react";
import type { ModuleScope } from "~/lib/module-register";
import { seedOf } from "~/lib/server-seed.server";
import { SWRServerSeed, type ServerSeedEntry } from "~/lib/swr/server-seed";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";

type TenantContext = NonNullable<
  Awaited<ReturnType<typeof readTenantPageContext>>
>;

export async function TenantRouteSeed({
  slug,
  module,
  claims,
  load,
  children,
}: {
  slug: string;
  module?: ModuleScope;
  claims?: readonly string[];
  load: (
    context: TenantContext,
  ) => readonly ServerSeedEntry[] | Promise<readonly ServerSeedEntry[]>;
  children: ReactNode;
}) {
  const builtAt = Date.now();
  const seed = readTenantPageContext(slug, module)
    .then(async (context) =>
      context ? seedOf(context.snapshot, await load(context), builtAt) : null,
    )
    .catch(() => null);

  // Loaders that resolve dependent keys pass their known initial keys as
  // claims. Navigation can then commit the page while the seed is streaming.
  return (
    <SWRServerSeed seed={claims ? seed : await seed} claims={claims} render>
      {children}
    </SWRServerSeed>
  );
}

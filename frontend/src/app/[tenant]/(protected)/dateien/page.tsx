import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/files.generated";
import { hasPermission } from "~/lib/auth-utils";
import { toFolderOverview } from "~/lib/files-api";
import { fileKeys, schoolTraegerDocumentKeys } from "~/lib/swr/portal-keys";
import * as traegerContract from "~/lib/contract/traeger-documents.generated";
import { mapSharedDocument } from "~/lib/traeger-documents-api";
import PageContent from "./page-content";

export default async function DateienPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session }) => {
        return [
          {
            key: fileKeys.folders(),
            render: true,
            value: seedRead("GET /api/files/folders", async (signal) => {
              const { data } = await readContract(
                routes["GET /api/files/folders"],
                { token, signal },
              );
              return toFolderOverview(data);
            }),
          },
          ...(hasPermission(session, "files:manage")
            ? [
                {
                  key: schoolTraegerDocumentKeys.list(),
                  value: seedRead(
                    "GET /api/traeger-documents/",
                    async (signal) => {
                      const { data } = await readContract(
                        traegerContract.routes["GET /api/traeger-documents/"],
                        { token, signal },
                      );
                      return (data ?? []).map(mapSharedDocument);
                    },
                  ),
                },
              ]
            : []),
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}

// Temporary (#7563): the current client reads and creates children through
// the catalog proxy and maps the contract's shape itself (lib/student-api);
// it marks its requests with the header of lib/contract/wire, which this file
// hands to the proxy. Without the header, an installed app with an older
// bundle still gets the shape this file builds: rows mapped onto the
// browser's Student, the consent written and read beside the create. Delete
// this file, its test and lib/contract/wire after the next production
// deploy; the portal's catch-all then answers the path.
import type { NextRequest } from "next/server";
import { contractGet, contractWrite } from "~/lib/contract/client.server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { routes } from "~/lib/contract/students.generated";
import { asksForContractWire } from "~/lib/contract/wire";
import { withPrivateNoStore } from "~/lib/private-no-store";
import type { RouteContext } from "~/lib/route-wrapper-utils.server";
import {
  catalogProxy,
  createGetHandler,
  createPostHandler,
} from "~/lib/route-wrapper.server";
import { createLogger } from "~/lib/logger";
import type { Student, StudentPage } from "~/lib/student-helpers";
import {
  mapStudentListRow,
  mapStudentResponse,
  type StudentView,
} from "~/lib/student-wire";
import {
  buildStudentCreateRequest,
  type StudentCreateBody,
} from "~/lib/student-request.server";
import {
  readConsentAfterWrite,
  sentConsentPair,
  writeConsent,
} from "~/lib/student-privacy-consent.server";

const logger = createLogger({ component: "StudentsRoute" });
const LIST = routes["GET /api/students/"];
const CREATE = routes["POST /api/students/"];

// Callers that don't paginate (Kindersuche, database list views) get every row
// in one trip; an explicit page_size is honored up to the cap, so an
// authenticated caller can't force an arbitrarily large query. The room-detail
// modal sends 200 and drives its own overflow notice from it (#1374).
const MAX_PAGE_SIZE = 1000;

function pageSize(raw: string | null): number {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_PAGE_SIZE)
    : MAX_PAGE_SIZE;
}

function studentView(raw: string | null): StudentView {
  return raw === "slim" || raw === "names" ? raw : "full";
}

const legacyGet = createGetHandler(
  async (request: NextRequest, token: string): Promise<StudentPage> => {
    const query = new URLSearchParams(request.nextUrl.searchParams);
    query.set("page_size", String(pageSize(query.get("page_size"))));
    const view = studentView(query.get("view"));

    const result = await contractGet(
      `${LIST.method} ${LIST.pattern}`,
      LIST.response[view],
      `/api/students?${query.toString()}`,
      token,
    );
    if (!result.ok) {
      const context = { error: result.error.cause.message };
      // A rate-limited list is expected under load and stays a warning.
      if (result.error.status === 429) {
        logger.warn("students fetch failed", {
          ...context,
          rate_limited: true,
        });
      } else {
        logger.error("students fetch failed", context);
      }
      throw result.error.cause;
    }
    return {
      data: result.value.data.map((row) => mapStudentListRow(row, view)),
      pagination: result.value.pagination,
    };
  },
);

/**
 * Creates the student (with guardians and weekly schedules in the same
 * backend transaction), then the privacy consent the form changed. The consent
 * lives at another backend endpoint, so it cannot join that transaction: when
 * it fails, the child exists anyway and the answer carries the consent that is
 * actually stored and `privacy_consent_saved: false`, so the form can say that
 * the input was lost and the person can correct it on the child's page (#5970).
 * The marker is absent whenever nothing was lost.
 */
const legacyPost = createPostHandler<Student, StudentCreateBody>(
  async (_request, body, token) => {
    const backendRequest = buildStudentCreateRequest(body);
    const consent = sentConsentPair(body);
    const created = await contractWrite(
      CREATE,
      "/api/students",
      token,
      backendRequest,
    );
    if (!created.ok) throw created.error.cause;
    const student = created.value.data;

    let written = consent;
    if (consent) {
      try {
        await writeConsent(student.id, token, consent);
      } catch (consentError) {
        written = null;
        logger.error("privacy consent write failed after student create", {
          student_id: student.id,
          error:
            consentError instanceof Error
              ? consentError.message
              : String(consentError),
        });
      }
    }

    return {
      ...mapStudentResponse(student),
      ...(await readConsentAfterWrite(student.id, token, written)),
      ...(consent && !written && { privacy_consent_saved: false }),
    };
  },
);

// The path the portal's catch-all would receive for /api/students.
const catalogPath = { params: Promise.resolve({ path: ["students"] }) };
const catalogGet = catalogProxy(portalRoutes.tenant, "GET");
const catalogPost = catalogProxy(portalRoutes.tenant, "POST");

export const GET = withPrivateNoStore(
  (request: NextRequest, context: RouteContext) =>
    asksForContractWire(request)
      ? catalogGet(request, catalogPath)
      : legacyGet(request, context),
);

export const POST = withPrivateNoStore(
  (request: NextRequest, context: RouteContext) =>
    asksForContractWire(request)
      ? catalogPost(request, catalogPath)
      : legacyPost(request, context),
);

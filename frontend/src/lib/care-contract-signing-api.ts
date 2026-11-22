// Unterschrift eines Betreuungsvertrags (#4679): dieselbe Ansicht über den
// einmaligen Link aus der Mail (ohne Konto) und in der Eltern-App unter
// „Dokumente“. Das Backend liefert Vertrag, Prüfsumme des PDFs und
// Widerrufsbelehrung; die Unterschrift schließt den Vertrag ab.

import { apiErrorFromResponse, transportFetch } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type { SignRequest as WireSignRequest } from "./contract/public-care-contract-signing.generated";
import type { SigningView as WireSigningView } from "./contract/shared.generated";
import type { SignatureValue } from "./signature";
import type { CareContractStatus, Weekday } from "./traeger-care-contracts-api";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const STATUS_VALUES = [
  "entwurf",
  "versendet",
  "aktiv",
  "gekuendigt",
  "widerrufen",
  "beendet",
] as const satisfies readonly CareContractStatus[];
const WEEKDAY_VALUES = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const satisfies readonly Weekday[];
const SIGNATURE_METHOD_VALUES = ["drawn", "typed", "paper"] as const;

type SignatureMethod = (typeof SIGNATURE_METHOD_VALUES)[number];

export interface SigningService {
  readonly weekday: Weekday;
  readonly moduleName: string;
  readonly endsAt: string;
  readonly lastDay: string | null;
}

interface SigningSignature {
  /** undefined: a method this build does not know. */
  readonly method: SignatureMethod | undefined;
  readonly signerName: string;
  readonly signedAt: string;
  readonly earlyStartRequested: boolean;
  readonly withdrawalEndsOn: string | null;
}

export interface SigningView {
  /** undefined: a state this build does not know; the page offers no signing. */
  readonly status: CareContractStatus | undefined;
  readonly traegerName: string;
  readonly partyName: string;
  readonly childName: string;
  readonly schoolName: string;
  readonly phaseName: string;
  readonly effectiveFrom: string;
  readonly endsOn: string | null;
  readonly priceCents: number | null;
  readonly services: readonly SigningService[];
  readonly documentSha256: string;
  readonly withdrawalNotice: readonly string[];
  readonly signature: SigningSignature | null;
}

function mapSigningView(raw: WireSigningView): SigningView {
  const version = raw.version;
  return {
    status: knownEnum(STATUS_VALUES, raw.status),
    traegerName: raw.traeger_name,
    partyName: raw.party_name,
    childName: `${version.child_first_name} ${version.child_last_name}`.trim(),
    schoolName: version.school_name,
    phaseName: version.phase_name,
    effectiveFrom: requiredDay(
      version.effective_from,
      "SigningContract.effective_from",
    ),
    endsOn: version.ends_on,
    priceCents: version.price_cents,
    // A service on a weekday this build does not know has no row to show.
    services: (version.services ?? []).flatMap((service) => {
      const weekday = knownEnum(WEEKDAY_VALUES, service.weekday);
      return weekday === undefined
        ? []
        : [
            {
              weekday,
              moduleName: service.module_name,
              endsAt: service.ends_at,
              lastDay: service.last_day,
            },
          ];
    }),
    documentSha256: raw.document_sha256,
    withdrawalNotice: raw.withdrawal_notice ?? [],
    signature: raw.signature
      ? {
          method: knownEnum(SIGNATURE_METHOD_VALUES, raw.signature.method),
          signerName: raw.signature.signer_name,
          signedAt: raw.signature.signed_at,
          earlyStartRequested: raw.signature.early_start_requested,
          withdrawalEndsOn: raw.signature.withdrawal_ends_on,
        }
      : null,
  };
}

interface SigningInput {
  readonly signature: SignatureValue;
  readonly noticeAcknowledged: boolean;
  readonly earlyStart: boolean;
}

function signBody(input: SigningInput): WireSignRequest {
  return {
    method: input.signature.method,
    image_png: input.signature.imagePngBase64,
    ...(input.signature.typedName === undefined
      ? {}
      : { typed_name: input.signature.typedName }),
    withdrawal_notice_acknowledged: input.noticeAcknowledged,
    early_start_requested: input.earlyStart,
  };
}

async function request(url: string, init: RequestInit): Promise<SigningView> {
  const response = await transportFetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Care contract signing failed: ${response.status}`,
    );
  }
  const body = (await response.json()) as { data: WireSigningView };
  return mapSigningView(body.data);
}

/** Where a contract to sign comes from: the mail link or the inbox. */
export type SigningSource =
  | { readonly kind: "link"; readonly link: string }
  | {
      readonly kind: "inbox";
      readonly organizationId: string;
      readonly contractId: string;
    };

function basePath(source: SigningSource): string {
  return source.kind === "link"
    ? `/api/public/care-contract-signing/${encodeURIComponent(source.link)}`
    : `/api/parent/me/documents/${encodeURIComponent(source.organizationId)}/contracts/${encodeURIComponent(source.contractId)}`;
}

/** Reads the contract. Reading never uses the mail link up. */
export function fetchSigningView(source: SigningSource): Promise<SigningView> {
  const url =
    source.kind === "link" ? basePath(source) : `${basePath(source)}/signing`;
  return request(url, { method: "GET" });
}

/** Signs the contract; the mail link is closed afterwards. */
export function signContract(
  source: SigningSource,
  input: SigningInput,
): Promise<SigningView> {
  return request(`${basePath(source)}/sign`, {
    method: "POST",
    body: JSON.stringify(signBody(input)),
  });
}

/** The address of the frozen PDF the parents sign. */
export function signingDocumentUrl(source: SigningSource): string {
  return source.kind === "link"
    ? `${basePath(source)}/document`
    : `${basePath(source)}/pdf`;
}

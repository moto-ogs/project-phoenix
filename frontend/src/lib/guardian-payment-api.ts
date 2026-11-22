import { bffFile, bffJson } from "./bff-fetch";
import {
  downloadBlob,
  filenameFromDisposition,
  openBlobForPrint,
} from "./file-download";

/**
 * Guardian payment data (#2608). Bank details hang off the guardian, not off
 * the child: a child has no bank account, and guardians are already shared
 * across siblings, so one maintained IBAN covers every sibling. Which of a
 * child's guardians is charged is a separate, per-child mark.
 *
 * Everything here needs the `guardians:financial` permission. The IBAN arrives
 * masked by default; `revealGuardianPayment` writes a GDPR access-log row
 * server-side, which is why it is a POST.
 */

export interface GuardianPaymentMasked {
  guardianId: string;
  ibanMasked: string | null;
  accountHolder: string | null;
}

export interface GuardianPaymentPlain {
  guardianId: string;
  iban: string | null;
  accountHolder: string | null;
}

export interface GuardianPaymentInput {
  iban: string | null;
  accountHolder: string | null;
}

export interface PaymentOverviewRow {
  studentId: string;
  studentName: string;
  schoolClass: string;
  guardianId: string | null;
  guardianName: string;
  relationshipType: string;
  accountHolder: string;
  ibanMasked: string;
}

export type PaymentExportFormat = "pdf" | "xlsx" | "docx";

// A failed request becomes an ApiError with the wire code, field errors and
// request ID, so the shared error display shows the catalog text (#2517).
// The message is a diagnostic for the logs.
export async function fetchGuardianPayment(
  guardianId: string,
): Promise<GuardianPaymentMasked> {
  const payment = await bffJson("tenant", "GET /api/guardians/{id}/payment", {
    params: { id: guardianId },
    errorMessage: "load guardian payment failed",
  });
  return {
    guardianId: payment.guardian_id,
    ibanMasked: payment.iban_masked,
    accountHolder: payment.account_holder,
  };
}

export async function revealGuardianPayment(
  guardianId: string,
): Promise<GuardianPaymentPlain> {
  const payment = await bffJson(
    "tenant",
    "POST /api/guardians/{id}/payment/reveal",
    {
      params: { id: guardianId },
      errorMessage: "reveal guardian payment failed",
    },
  );
  return {
    guardianId: payment.guardian_id,
    iban: payment.iban,
    accountHolder: payment.account_holder,
  };
}

export async function updateGuardianPayment(
  guardianId: string,
  input: GuardianPaymentInput,
): Promise<void> {
  await bffJson("tenant", "PUT /api/guardians/{id}/payment", {
    params: { id: guardianId },
    body: { iban: input.iban, account_holder: input.accountHolder },
    errorMessage: "update guardian payment failed",
  });
}

/** Marks which guardian pays for this child; null clears the assignment. */
export async function setStudentPayer(
  studentId: string,
  guardianId: string | null,
): Promise<void> {
  await bffJson("tenant", "PUT /api/guardians/students/{studentId}/payer", {
    params: { studentId },
    body: { guardian_id: guardianId },
    errorMessage: "set student payer failed",
  });
}

export async function fetchPaymentOverview(): Promise<PaymentOverviewRow[]> {
  const rows = await bffJson("tenant", "GET /api/guardians/payment-overview", {
    errorMessage: "load payment overview failed",
  });
  return rows.map((row) => ({
    studentId: row.student_id,
    studentName: row.student_name,
    schoolClass: row.school_class,
    guardianId: row.guardian_id,
    guardianName: row.guardian_name,
    relationshipType: row.relationship_type,
    accountHolder: row.account_holder,
    ibanMasked: row.iban_masked,
  }));
}

/**
 * Downloads the Bankverbindungen list. The file carries UNMASKED IBANs and the
 * request is audited as its own event server-side.
 */
export async function exportPaymentOverview(
  format: PaymentExportFormat,
  printTarget?: Window,
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "POST /api/guardians/payment-overview/export",
    { body: { format }, errorMessage: "export payment overview failed" },
  );
  const blob = await response.blob();
  if (printTarget) {
    await openBlobForPrint(blob, printTarget);
    return;
  }
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `Bankverbindungen.${format}`,
  );
}

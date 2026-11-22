// Wie und bis wann eine Rechnung bezahlt wird (#4689): Zahlungsweg und
// Fälligkeit, mit einem leisen Hinweis, wenn der Tag von der Familie kommt.

import type { InvoicePayment } from "~/lib/traeger-billing-terms-api";
import {
  PAYMENT_METHOD_LABELS,
  dueOnText,
  dueSourceHint,
} from "./billing-payment-format";
import { labelOf } from "~/lib/label-of";

export function InvoicePaymentLine({
  payment,
}: Readonly<{ payment: InvoicePayment }>) {
  const hint = dueSourceHint(payment);
  return (
    <p className="mt-0.5 text-sm text-gray-600">
      {labelOf(PAYMENT_METHOD_LABELS, payment.method, "Zahlung")} ·{" "}
      <span className="whitespace-nowrap">{dueOnText(payment)}</span>
      {hint ? <span className="text-gray-500"> ({hint})</span> : null}
    </p>
  );
}

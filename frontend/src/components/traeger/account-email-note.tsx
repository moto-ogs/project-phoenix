// Rechnungen gehen an die E-Mail-Adresse des Elternkontos, der Vertrag
// bleibt wie unterschrieben (#8215). Weichen beide ab, sagt der Träger-Büro
// das an Vertrag und Rechnung, damit niemand die Vertragsadresse für die
// Rechnungsadresse hält (Regel „Kopie oder Verbindung“).

/** Whether two mail addresses differ, ignoring case and outer spaces. */
export function differentEmail(
  first: string | undefined,
  second: string | undefined,
): boolean {
  const a = first?.trim().toLowerCase() ?? "";
  const b = second?.trim().toLowerCase() ?? "";
  return a !== "" && b !== "" && a !== b;
}

/**
 * At a contract party: where the invoices go, when the parents account has
 * another address than the contract. Nothing when they match.
 */
export function PartyInvoiceEmail({
  email,
  accountEmail,
}: Readonly<{ email: string; accountEmail?: string }>) {
  if (!differentEmail(email, accountEmail)) return null;
  return (
    <span className="block text-sm font-normal text-gray-600">
      Rechnungen gehen an{" "}
      <span className="font-medium wrap-anywhere text-gray-900">
        {accountEmail}
      </span>
      . Diese Adresse steht im Elternkonto. Der Vertrag bleibt, wie er
      unterschrieben wurde.
    </span>
  );
}

/**
 * At an invoice: it goes to the address of the parents account, not to the
 * one in the contract. Nothing when the invoice goes to the contract's.
 */
export function InvoiceAccountEmail({
  email,
  contractEmail,
}: Readonly<{ email: string; contractEmail?: string }>) {
  if (!differentEmail(email, contractEmail)) return null;
  return (
    <p className="mt-0.5 text-sm wrap-anywhere text-gray-600">
      Per E-Mail an {email} aus dem Elternkonto. Im Vertrag steht{" "}
      {contractEmail}.
    </p>
  );
}

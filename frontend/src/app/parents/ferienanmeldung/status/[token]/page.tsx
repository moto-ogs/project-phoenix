// Stand einer Ferienanmeldung (#6676): der geheime Link aus der Eingangsmail.
// Eltern brauchen kein Konto.

import { readHolidayRegistrationStatusSeed } from "~/lib/token-status-seed.server";
import HolidayRegistrationStatusPage from "./status-page";

export default function Page({
  params,
}: Readonly<{
  params: Promise<{ token: string }>;
}>) {
  const initial = params.then(({ token }) =>
    readHolidayRegistrationStatusSeed(token),
  );
  return <HolidayRegistrationStatusPage params={params} initial={initial} />;
}

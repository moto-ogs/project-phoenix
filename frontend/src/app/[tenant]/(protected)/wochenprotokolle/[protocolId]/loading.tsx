import { TenantPage } from "~/components/ui/tenant-page";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const WEEK_PROTOCOL_INFO =
  "Hier siehst du, was moto in dieser Woche festgehalten hat. Bei einem Entwurf kannst du mit „Ergänzen“ etwas dazuschreiben und es abschließen. Ein abgeschlossenes Protokoll lädst du als PDF herunter.";

/** Route-level loading UI of one weekly protocol. */
export default function WeekProtocolLoading() {
  return (
    <TenantPage
      info={WEEK_PROTOCOL_INFO}
      title="Wochenprotokoll"
      back
      backHref="/wochenprotokolle"
      backLabel="Zurück zu den Wochenprotokollen"
      loading
    />
  );
}

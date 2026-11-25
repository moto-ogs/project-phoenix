import { messageBoundary } from "~/i18n/scoped-messages";
import { KitLocaleFromIntl } from "~/components/ui/kit-locale-intl";

const EnrollmentShellMessages = messageBoundary("language");

/** Public enrollment localizes the kit and the shared language switcher. */
export default function EnrollLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <EnrollmentShellMessages>
      {/* Kit-Standardtexte sind deutsch; übersetzte Anmeldungen lassen sie weg. */}
      <KitLocaleFromIntl>{children}</KitLocaleFromIntl>
    </EnrollmentShellMessages>
  );
}

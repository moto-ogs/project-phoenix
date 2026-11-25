import "~/styles/globals.css";

import { Suspense } from "react";
import { RootDocument, generateMetadata } from "./root-document";

export { generateMetadata };

/**
 * Kein maximumScale und kein userScalable: die App muss auf jedem Gerät
 * vergrößert werden können (#2267). Ein gesperrter Zoom sperrt genau die
 * Menschen aus, die ihn brauchen.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Request-time locale must set the actual HTML language, including without
  // JavaScript. This boundary also lets the reusable preview omit the document
  // until the public host and locale are known.
  return (
    <Suspense>
      <RootDocument>{children}</RootDocument>
    </Suspense>
  );
}

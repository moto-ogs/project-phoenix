import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";

/**
 * Real SWR and a Träger session, isolated per render. Only the API modules
 * are mocked. The test file needs `vi.unmock("swr")`.
 */
export function TraegerResourceTestProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{
        user: { id: "traeger-test", scope: "org", orgId: 7 },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    </SessionProvider>
  );
}

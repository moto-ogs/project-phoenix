"use client";

import { useEffect, useRef, useState } from "react";
import { DemoSetupScreen } from "~/components/demo/demo-setup-screen";
import { DemoOpening, DemoProblem } from "~/components/demo/demo-shell";
import { ApiError } from "~/lib/api-error";
import {
  type DemoEntryPhase,
  type DemoLink,
  type DemoSetupProgress,
  demoEntryEvent,
  demoLinkFragment,
  redeemDemoAccess,
  startDemoSession,
  takeDemoLinkFromFragment,
  waitForDemoSchool,
} from "~/lib/demo-access";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "TraegerDemoEntryPage" });

// Entry page of the Träger-Portal in the public demo (#6193). The same link
// that opens the OGS app arrives here with the role Träger-Büro: from the
// waiting room, from the OGS app's entry page or from the banner. The page
// waits until the demo school can be entered, redeems the token at the
// school's own Demo-Träger and signs in to the Träger-Portal. A school under
// the shared Demo-Träger has no office to enter; its visitor goes on to the
// OGS app and picks a role there.
export default function TraegerDemoEntryPage() {
  const [phase, setPhase] = useState<DemoEntryPhase>("opening");
  const [setup, setSetup] = useState<DemoSetupProgress>({ step: 0 });
  // Every try enters anew; "Noch einmal versuchen" starts the next one.
  const [attempt, setAttempt] = useState(0);
  const linkRef = useRef<DemoLink | null | undefined>(undefined);

  // oxlint-disable-next-line swr/no-effect-load -- sessionless demo entry: consumes the fragment token, polls the demo school setup and starts the demo session
  useEffect(() => {
    const run = { cancelled: false };

    async function enter(link: DemoLink): Promise<DemoEntryPhase | "left"> {
      const waited = await waitForDemoSchool(link.token, run, (progress) => {
        setSetup(progress);
        setPhase("preparing");
      });
      if (waited.phase === "cancelled") return "opening";
      if (waited.phase !== "ready") return waited.phase;
      if (!waited.schoolUrl?.startsWith("http")) {
        throw new Error("ready demo school without an address");
      }
      const schoolEntry = `${waited.schoolUrl}/demo`;
      let session;
      try {
        session = await redeemDemoAccess(link.token, "traeger");
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === "identity.demo_access_invalid"
        ) {
          // No Träger of its own: the role cards of the OGS app instead.
          globalThis.location.assign(
            `${schoolEntry}${demoLinkFragment({ token: link.token })}`,
          );
          return "left";
        }
        throw error;
      }
      if (!session) return "invalid";
      const started = await startDemoSession(
        {
          ...session,
          visit: { ...session.visit, schoolName: waited.schoolName },
        },
        demoEntryEvent(link),
      );
      if (!started) return "failed";
      globalThis.location.assign("/");
      return "left";
    }

    // The fragment is read once and removed; a repeated effect run (React
    // strict mode, another try) must find the link again.
    if (linkRef.current === undefined) {
      linkRef.current = takeDemoLinkFromFragment();
    }
    const link = linkRef.current;
    if (!link) {
      setPhase("invalid");
      return;
    }
    enter(link)
      .then((outcome) => {
        if (!run.cancelled && outcome !== "left") setPhase(outcome);
      })
      .catch((error: unknown) => {
        logger.error("traeger_demo_entry_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!run.cancelled) setPhase("failed");
      });
    return () => {
      run.cancelled = true;
    };
  }, [attempt]);

  if (phase === "opening") return <DemoOpening />;
  if (phase === "preparing") return <DemoSetupScreen {...setup} />;
  return (
    <DemoProblem
      phase={phase}
      onRetry={() => {
        setPhase("opening");
        setAttempt((current) => current + 1);
      }}
    />
  );
}

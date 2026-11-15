// Der Versandstand von Schreiben (#4684) und Jahresbescheiden (#6347): wie
// viele gesendet sind, als Balken und als fünf Kacheln. Jedes Schreiben steht
// in genau einer Kachel.

import { useState } from "react";
import { ProgressBar } from "~/components/ui/progress-bar";
import { ScreenReaderStatus } from "~/components/ui/screen-reader-status";
import { StatCard } from "~/components/ui/stat-card";

/** The counts both kinds of letter report. */
export interface LetterSendCounts {
  readonly letters: number;
  readonly sent: number;
  readonly queued: number;
  readonly failed: number;
  readonly notSent: number;
  readonly withoutEmail: number;
}

/** The letters „An alle senden“ sends: open ones of families with an address. */
export function lettersToSend(summary: LetterSendCounts): number {
  return Math.max(0, summary.notSent - summary.withoutEmail);
}

const LETTER_NOUN = { one: "Schreiben", many: "Schreiben" } as const;

export function LetterSendState({
  summary,
  noun = LETTER_NOUN,
}: Readonly<{
  summary: LetterSendCounts;
  /** What is sent, after „von N“: „Schreiben“, „Bescheid/Bescheiden“. */
  noun?: { readonly one: string; readonly many: string };
}>) {
  const open = lettersToSend(summary);
  const progress = `${summary.sent} von ${summary.letters} ${summary.letters === 1 ? noun.one : noun.many} gesendet`;

  // The end of a send is said once (#7113, WCAG 4.1.3): the page reloads
  // the counts while letters go out, and once none is left on its way a
  // screen reader hears the result. A send that finished before the first
  // reload shows as more sent or failed letters. The state on opening says
  // nothing.
  const sending = summary.queued > 0;
  const [seen, setSeen] = useState({
    sending,
    sent: summary.sent,
    failed: summary.failed,
  });
  const [announcement, setAnnouncement] = useState("");
  if (
    sending !== seen.sending ||
    summary.sent !== seen.sent ||
    summary.failed !== seen.failed
  ) {
    const finished =
      !sending &&
      (seen.sending ||
        summary.sent > seen.sent ||
        summary.failed > seen.failed);
    setSeen({ sending, sent: summary.sent, failed: summary.failed });
    if (sending) setAnnouncement("");
    else if (finished)
      setAnnouncement(
        `Der Versand ist fertig. ${progress}${summary.failed > 0 ? `, ${summary.failed} nicht angekommen` : ""}.`,
      );
  }

  return (
    <div className="space-y-3">
      <ScreenReaderStatus
        message={announcement}
        data-testid="letter-send-announcement"
      />
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-900 tabular-nums">
          {progress}
        </p>
        <ProgressBar
          value={summary.sent}
          max={Math.max(summary.letters, 1)}
          tone="green"
          size="md"
          label={progress}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard variant="tile" label="Gesendet" value={summary.sent} />
        <StatCard
          variant="tile"
          label="Wird gesendet"
          value={summary.queued}
          tone={summary.queued > 0 ? "blue" : undefined}
        />
        <StatCard
          variant="tile"
          label="Nicht angekommen"
          value={summary.failed}
          tone={summary.failed > 0 ? "red" : undefined}
        />
        <StatCard variant="tile" label="Noch nicht gesendet" value={open} />
        <StatCard
          variant="tile"
          label="Ohne E-Mail"
          value={summary.withoutEmail}
          tone={summary.withoutEmail > 0 ? "orange" : undefined}
        />
      </div>
    </div>
  );
}

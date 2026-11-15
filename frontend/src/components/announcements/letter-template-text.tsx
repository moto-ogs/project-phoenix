import { Fragment } from "react";

import { LinkifiedText } from "~/components/ui/linkified-text";

const PLACEHOLDER_PATTERN = /(\{\{\s*[^{}]*?\s*\}\})/g;

/** What a placeholder stands for, as the composer names it. */
const PLACEHOLDER_LABELS: Readonly<Record<string, string>> = {
  vorname: "Vorname",
  nachname: "Nachname",
  klasse: "Klasse",
  gruppe: "Gruppe",
  betreuungstage: "Betreuungstage",
  abholzeit: "Abholzeit",
};

/** Whether a letter text names any placeholder. */
export function hasLetterPlaceholders(text: string): boolean {
  return /\{\{[^{}]*\}\}/.test(text);
}

function labelOf(token: string): string {
  const name = token.replace(/[{}\s]/g, "").toLowerCase();
  return PLACEHOLDER_LABELS[name] ?? name;
}

/**
 * Der Text eines Elternbriefs mit seinen Platzhaltern (#4813): jeder
 * Platzhalter steht als Feld mit seinem Namen im Text, so liest das Personal,
 * wo moto die Angaben jedes Kindes einsetzt.
 */
export function LetterTemplateText({ text }: Readonly<{ text: string }>) {
  const parts = text.split(PLACEHOLDER_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          // oxlint-disable-next-line ui-kit/no-hand-rolled-pill -- inline field marker in running text, not a status pill
          <mark
            // Parts are split from one fixed text; the index is stable.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className="bg-moto-green-soft text-moto-green-strong rounded-md px-1 py-0.5 font-medium"
          >
            {labelOf(part)}
          </mark>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <Fragment key={index}>
            <LinkifiedText text={part} />
          </Fragment>
        ),
      )}
    </>
  );
}

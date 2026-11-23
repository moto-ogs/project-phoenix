"use client";

import { LinkifiedText } from "~/components/ui/linkified-text";
import { splitLetterText } from "~/lib/parent-letter-placeholders";

import { useLetterPlaceholders } from "./use-letter-placeholders";
import type { AnnouncementApiBase } from "~/lib/parent-announcements-api";

/**
 * Der Text eines Elternbriefs mit seinen Platzhaltern (#4813) als
 * Fließtext: jeder Platzhalter steht als grünes Feld mit seinem Namen.
 * Ohne `links` bleibt der Text ohne Verweise, etwa in einer klickbaren Zeile.
 */
export function LetterTemplateInline({
  text,
  apiBase,
  links = true,
}: Readonly<{ text: string; apiBase?: AnnouncementApiBase; links?: boolean }>) {
  const { labels } = useLetterPlaceholders(apiBase);
  return (
    <>
      {splitLetterText(text).map((part, index) =>
        part.kind === "placeholder" ? (
          // oxlint-disable-next-line ui-kit/no-hand-rolled-pill -- inline field marker in running text, not a status pill
          <mark
            // Parts are cut from one fixed text; the index is stable.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className="bg-moto-green-soft text-moto-green-strong rounded-md px-1 py-0.5 font-medium"
          >
            {labels.get(part.name) ?? part.name}
          </mark>
        ) : links ? (
          // eslint-disable-next-line react/no-array-index-key
          <LinkifiedText key={index} text={part.text} />
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/**
 * Der Text eines Elternbriefs mit seinen Platzhaltern (#4813), so liest das
 * Personal, wo moto die Angaben jedes Kindes einsetzt.
 */
export function LetterTemplateText({
  text,
  apiBase,
}: Readonly<{ text: string; apiBase?: AnnouncementApiBase }>) {
  return (
    <>
      <p className="text-sm leading-6 whitespace-pre-line text-gray-800">
        <LetterTemplateInline text={text} apiBase={apiBase} />
      </p>
      <p className="mt-3 text-xs text-gray-500">
        Die grünen Felder füllt moto für jedes Kind mit seinen Angaben. Jede
        Familie liest nur den Brief ihres eigenen Kindes.
      </p>
    </>
  );
}

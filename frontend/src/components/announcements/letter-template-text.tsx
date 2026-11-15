"use client";

import { LinkifiedText } from "~/components/ui/linkified-text";
import { splitLetterText } from "~/lib/parent-letter-placeholders";

import { useLetterPlaceholders } from "./use-letter-placeholders";

/**
 * Der Text eines Elternbriefs mit seinen Platzhaltern (#4813): jeder
 * Platzhalter steht als grünes Feld mit seinem Namen im Text, so liest das
 * Personal, wo moto die Angaben jedes Kindes einsetzt.
 */
export function LetterTemplateText({
  text,
  apiBase,
}: Readonly<{ text: string; apiBase?: string }>) {
  const { labels } = useLetterPlaceholders(apiBase);
  return (
    <>
      <p className="text-sm leading-6 whitespace-pre-line text-gray-800">
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
          ) : (
            // eslint-disable-next-line react/no-array-index-key
            <LinkifiedText key={index} text={part.text} />
          ),
        )}
      </p>
      <p className="mt-3 text-xs text-gray-500">
        Die grünen Felder füllt moto für jedes Kind mit seinen Angaben. Jede
        Familie liest nur den Brief ihres eigenen Kindes.
      </p>
    </>
  );
}

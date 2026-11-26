"use client";

import React from "react";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { useLatest } from "~/lib/hooks/use-latest";
import type { SearchBarProps } from "./types";

interface DebouncedSearchValue {
  readonly shownValue: string;
  readonly draftError?: string;
  readonly handleChange: (next: string) => void;
  readonly commitNow: (next: string) => void;
}

const DebouncedSearchValueContext =
  React.createContext<DebouncedSearchValue | null>(null);

/**
 * Local draft of the typed text, reported upwards only after `debounceMs` of
 * silence (#2975). Without a debounce the owning page re-renders per keystroke;
 * with one, only this input does. `value` keeps winning when the owner reports
 * a new term; `resetKey` makes an external reset explicit when that term is
 * already the current controlled value.
 */
function useDebouncedSearchValue(
  value: string,
  onChange: (next: string) => void,
  debounceMs: number | undefined,
  resetKey: string | number | undefined,
  validateDraft?: (draft: string) => string | undefined,
): DebouncedSearchValue {
  const [draft, setDraft] = React.useState(value);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useLatest(onChange);
  const validate = useLatest(validateDraft);

  React.useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setDraft(value);
  }, [resetKey, value]);

  React.useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleChange = React.useCallback(
    (next: string) => {
      if (debounceMs || validate.current) setDraft(next);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (validate.current?.(next)) return;
      if (!debounceMs) {
        onChangeRef.current(next);
        return;
      }
      timeoutRef.current = setTimeout(() => {
        onChangeRef.current(next);
      }, debounceMs);
    },
    [debounceMs, onChangeRef, validate],
  );

  // The clear button is an explicit action, not typing: it reports at once so
  // the list is back immediately instead of after the debounce window.
  const commitNow = React.useCallback(
    (next: string) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setDraft(next);
      onChangeRef.current(next);
    },
    [onChangeRef],
  );

  const shownValue = debounceMs || validateDraft ? draft : value;
  return {
    shownValue,
    draftError: validateDraft?.(shownValue),
    handleChange,
    commitNow,
  };
}

interface SearchBarDraftProviderProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly debounceMs: number | undefined;
  readonly resetKey: string | number | undefined;
  readonly onDraftPendingChange?: (pending: boolean) => void;
  readonly validateDraft?: (draft: string) => string | undefined;
  readonly children: React.ReactNode;
}

/** Shares one typed draft between explicit responsive copies of one search field. */
export function SearchBarDraftProvider({
  value,
  onChange,
  debounceMs,
  resetKey,
  onDraftPendingChange,
  validateDraft,
  children,
}: Readonly<SearchBarDraftProviderProps>) {
  const draftState = useDebouncedSearchValue(
    value,
    onChange,
    debounceMs,
    resetKey,
    validateDraft,
  );
  const draftPending = draftState.shownValue !== value;
  // Actions outside the field must see the same pending state before paint.
  React.useLayoutEffect(() => {
    onDraftPendingChange?.(draftPending);
  }, [draftPending, onDraftPendingChange]);

  return (
    <DebouncedSearchValueContext.Provider value={draftState}>
      {children}
    </DebouncedSearchValueContext.Provider>
  );
}

function SearchBarContent({
  placeholder = "Name suchen...",
  onClear,
  className = "",
  size = "md",
  inputProps,
  draftState,
}: Readonly<SearchBarProps & { readonly draftState: DebouncedSearchValue }>) {
  const { shownValue, draftError, handleChange, commitNow } = draftState;
  const hintId = React.useId();
  const describedBy = inputProps?.["aria-describedby"];
  const sizeClasses = {
    // By finger 16 px: smaller text makes iOS zoom into the field.
    sm: "py-2 pl-9 pr-3 text-sm pointer-coarse:text-base",
    md: "py-2.5 pl-9 pr-3 text-sm pointer-coarse:text-base md:pl-10 md:pr-10",
    lg: "py-3 pl-10 pr-10 text-base",
  };

  const iconSizeClasses = {
    sm: "h-4 w-4",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <div className={className}>
      <div className="relative">
        <svg
          className={`absolute top-1/2 left-3 -translate-y-1/2 transform ${iconSizeClasses[size]} text-gray-400`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>

        <input
          {...inputProps}
          // A search only filters the page and holds no draft: a tab of an
          // earlier release may reload over it (lib/deployment-reload.ts).
          data-search-field=""
          type="text"
          placeholder={placeholder}
          value={shownValue}
          aria-invalid={draftError ? true : inputProps?.["aria-invalid"]}
          aria-describedby={
            draftError
              ? [describedBy, hintId].filter(Boolean).join(" ")
              : describedBy
          }
          onChange={(e) => handleChange(e.target.value)}
          className={`border-field-edge focus:border-field-focus w-full rounded-2xl border bg-white text-gray-900 placeholder-gray-500 transition duration-200 focus:ring-0 focus:outline-none ${sizeClasses[size]} ${shownValue ? "pr-10" : ""} `}
        />

        {shownValue && (
          <button
            type="button"
            aria-label="Suche löschen"
            onClick={() => {
              commitNow("");
              onClear?.();
            }}
            className="absolute top-1/2 right-2 -translate-y-1/2 transform rounded-full p-1 transition-colors hover:bg-gray-100 md:right-3"
          >
            <svg
              className={`${iconSizeClasses[size]} text-gray-400`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
      <FieldErrorHint id={hintId} message={draftError} live />
    </div>
  );
}

/**
 * Renders a responsive copy that uses the draft supplied by
 * `SearchBarDraftProvider`.
 */
export function SharedSearchBar(props: Readonly<SearchBarProps>) {
  const sharedDraftState = React.useContext(DebouncedSearchValueContext);

  if (!sharedDraftState) {
    throw new Error(
      "SharedSearchBar must be rendered inside SearchBarDraftProvider",
    );
  }

  return <SearchBarContent {...props} draftState={sharedDraftState} />;
}

/**
 * Ein einzelnes Suchfeld mit eigenem Entwurf, für eine Suche außerhalb der
 * Such- und Filterzeile von `TenantPage` (z. B. im Bedienband der
 * Planungsflächen). Die Zeile selbst rendert zwei Kopien desselben Felds und
 * teilt ihren Entwurf über `SearchBarDraftProvider`.
 */
export function SearchBar(props: Readonly<SearchBarProps>) {
  return (
    <SearchBarDraftProvider
      value={props.value}
      onChange={props.onChange}
      debounceMs={props.debounceMs}
      resetKey={props.resetKey}
    >
      <SharedSearchBar {...props} />
    </SearchBarDraftProvider>
  );
}

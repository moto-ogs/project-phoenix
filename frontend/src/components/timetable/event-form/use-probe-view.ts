"use client";

import { useCallback, useState } from "react";

/**
 * What an advisory probe of the Termin form shows (double bookings,
 * Dienstplan coverage). The probe itself is a shared cache read; this holds
 * its last answer while the next one is pending or the input still moves.
 *
 * `marker` names the read's current state (its answer, its error, or a
 * loading token) and `next` is the view for it. The view follows only a
 * change of the marker; `undefined` keeps the view. A value written with
 * `override` (the check right before saving) therefore stays until the read
 * reports something new. A new `generation` (the form started over) shows
 * `initial` again until the read's current state applies.
 */
export function useProbeView<T>(
  initial: T,
  generation: number,
  marker: unknown,
  next: T | undefined,
): { view: T; override: (view: T) => void } {
  const [state, setState] = useState<{
    generation: number;
    marker: unknown;
    view: T;
  }>({ generation, marker: undefined, view: initial });
  let current = state;
  if (generation !== current.generation) {
    current = { generation, marker: undefined, view: initial };
  }
  if (marker !== undefined && marker !== current.marker && next !== undefined) {
    current = { ...current, marker, view: next };
  }
  if (current !== state) setState(current);
  const override = useCallback(
    (view: T) => setState((prev) => ({ ...prev, view })),
    [],
  );
  return { view: current.view, override };
}

"use client";

import { createContext, useContext } from "react";

// The root document reads the preference cookie before rendering. Passing that
// small snapshot through the client boundary keeps the switch's server and
// hydration render in sync with html[data-contrast].
const ContrastPreferenceServerSnapshot = createContext(false);

export function ContrastPreferenceHydration({
  moreContrast,
  children,
}: Readonly<{ moreContrast: boolean; children: React.ReactNode }>) {
  return (
    <ContrastPreferenceServerSnapshot.Provider value={moreContrast}>
      {children}
    </ContrastPreferenceServerSnapshot.Provider>
  );
}

export function useContrastPreferenceServerSnapshot(): boolean {
  return useContext(ContrastPreferenceServerSnapshot);
}

"use client";

import { useState, type ReactNode } from "react";

// Avoid setting up the forms and their subscriptions on every page mount.
// After a dialog has opened, keep it mounted so its exit animation and
// close/reopen lifecycle still run normally.
export function MountOnFirstOpen({
  open,
  children,
}: Readonly<{ open: boolean; children: ReactNode }>) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return open || opened ? children : null;
}

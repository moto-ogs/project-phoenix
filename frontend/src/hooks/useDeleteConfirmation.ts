"use client";

import { useState, useCallback } from "react";

/** The caller closes the confirmation after its delete succeeds. */
export function useDeleteConfirmation() {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const handleDeleteClick = useCallback(() => setShowConfirmModal(true), []);
  const handleDeleteCancel = useCallback(() => setShowConfirmModal(false), []);
  return { showConfirmModal, handleDeleteClick, handleDeleteCancel };
}

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDeleteConfirmation } from "./useDeleteConfirmation";

describe("useDeleteConfirmation", () => {
  it("opens and closes the confirmation with stable handlers", () => {
    const { result } = renderHook(useDeleteConfirmation);
    const { handleDeleteClick, handleDeleteCancel } = result.current;

    expect(result.current.showConfirmModal).toBe(false);
    act(handleDeleteClick);
    expect(result.current.showConfirmModal).toBe(true);
    expect(result.current.handleDeleteClick).toBe(handleDeleteClick);
    expect(result.current.handleDeleteCancel).toBe(handleDeleteCancel);
    act(handleDeleteCancel);
    expect(result.current.showConfirmModal).toBe(false);
  });
});

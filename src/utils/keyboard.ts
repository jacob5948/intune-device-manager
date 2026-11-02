import type { KeyboardEvent } from "react";

/**
 * Enter and Space for a row that acts like a button but holds real buttons of its own.
 * Keys pressed on those inner controls are left to them.
 */
export const activateOnKey = (action: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
};

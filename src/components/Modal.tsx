import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  className?: string;
  /** Escape always closes */
  onClose: () => void;
  /** What a click outside does. Defaults to closing. */
  onOverlayClick?: () => void;
  children: ReactNode;
}

/**
 * Every dialog's shell: Escape to close, keyboard focus kept inside while open, and handed
 * back to whatever had it on close. The dialog is named by its first h3.
 */
const Modal = ({ className, onClose, onOverlayClick, children }: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Read during the first render: by the time an effect runs, autoFocus has already moved it
  const previouslyFocused = useRef(document.activeElement as HTMLElement | null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const heading = dialog.querySelector("h3");
    if (heading) {
      heading.id = headingId;
      dialog.setAttribute("aria-labelledby", headingId);
    }
    // Leave an autoFocus field alone; otherwise start on the dialog itself, so a stray
    // Enter cannot press its first button
    if (!dialog.contains(document.activeElement)) dialog.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active) || (e.shiftKey && (active === first || active === dialog))) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [headingId]);

  return (
    <div className="modal-overlay" onClick={onOverlayClick ?? onClose}>
      <div
        ref={dialogRef}
        className={className ? `modal ${className}` : "modal"}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export default Modal;

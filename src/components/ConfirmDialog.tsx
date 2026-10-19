import { useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmDialog({ title, description, confirmLabel, busy = false, onCancel, onConfirm }: Props) {
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  const dismiss = () => {
    if (busy || closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onCancel, 220);
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div className={`confirm-dialog-backdrop${closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
      <section aria-describedby="confirm-dialog-description" aria-labelledby="confirm-dialog-title" aria-modal="true" className={`confirm-dialog${closing ? " is-closing" : ""}`} role="alertdialog">
        <span aria-hidden="true" className="confirm-dialog-mark">!</span>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        <div className="confirm-dialog-actions">
          <button autoFocus className="confirm-dialog-cancel" disabled={busy || closing} onClick={dismiss} type="button">Cancel</button>
          <button className="confirm-dialog-confirm" disabled={busy} onClick={onConfirm} type="button">{busy ? "Working…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

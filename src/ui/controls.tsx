import {
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/* Custom controls replacing native WebKitGTK widgets (selects, checkboxes,
   popups) so every skin renders consistently. */

const Chevron = () => (
  <svg
    className="chevron"
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M2.5 4.5L6 8l3.5-3.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Check = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="M2 6.5L4.8 9.2 10 3.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export interface DropdownOption {
  value: string;
  label?: string;
  sub?: string;
}

export function Dropdown(props: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const selected = props.options.find((o) => o.value === props.value);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = props.options.findIndex((o) => o.value === props.value);
      const next =
        e.key === "ArrowDown"
          ? Math.min(idx + 1, props.options.length - 1)
          : Math.max(idx - 1, 0);
      props.onChange(props.options[next].value);
    }
  };

  return (
    <div className={`dropdown${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={props.ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span>
          {selected ? (selected.label ?? selected.value) : (props.placeholder ?? "Select…")}
        </span>
        <Chevron />
      </button>
      {open && (
        <div className="dropdown-panel" role="listbox" id={listId}>
          {props.options.map((option) => (
            <div
              key={option.value}
              role="option"
              aria-selected={option.value === props.value}
              className={`dropdown-item${option.value === props.value ? " selected" : ""}`}
              onClick={() => {
                props.onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label ?? option.value}</span>
              {option.sub && <span className="item-sub">{option.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Checkbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div
      className={`checkbox${props.checked ? " checked" : ""}`}
      role="checkbox"
      aria-checked={props.checked}
      tabIndex={0}
      onClick={() => props.onChange(!props.checked)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          props.onChange(!props.checked);
        }
      }}
    >
      <span className="checkbox-box">{props.checked && <Check />}</span>
      <span>
        <span className="checkbox-label">{props.label}</span>
        {props.sub && <div className="checkbox-sub">{props.sub}</div>}
      </span>
    </div>
  );
}

export function Toggle(props: {
  on: boolean;
  onChange: (on: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={`toggle${props.on ? " on" : ""}`}
      role="switch"
      aria-checked={props.on}
      aria-label={props.ariaLabel}
      onClick={() => props.onChange(!props.on)}
    />
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="radio"
          aria-checked={option.value === props.value}
          className={`segmented-item${option.value === props.value ? " active" : ""}`}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-header">
          <span className="modal-title">{props.title}</span>
        </div>
        <div className="modal-body">{props.children}</div>
        <div className="modal-footer">{props.footer}</div>
      </div>
    </div>
  );
}

export function Field(props: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </div>
  );
}

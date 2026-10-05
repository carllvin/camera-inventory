"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/actions";
import { buttonVariants } from "./ui";
import { cn } from "@/lib/format";

type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const FormStateContext = createContext<ActionState>(null);

/**
 * Form bound to a server action. Shows errors, keeps typed values after a failed
 * submit and disables the submit button while pending.
 */
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  resetOnSuccess,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  onSuccess?: (state: ActionState) => void;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const [generation, setGeneration] = useState(0);
  const prev = useRef<ActionState>(null);
  useEffect(() => {
    if (state && state !== prev.current) {
      prev.current = state;
      // Remount fields so defaultValue picks up echoed values (React resets forms after actions).
      if (!state.ok || resetOnSuccess) setGeneration((g) => g + 1);
      if (state.ok) onSuccess?.(state);
    }
  }, [state, onSuccess, resetOnSuccess]);
  return (
    <FormStateContext.Provider value={state}>
      <form action={formAction} noValidate>
        <FormMessage />
        {/* Layout classes go on the keyed wrapper so spacing/grid apply to the fields themselves. */}
        <div key={generation} className={className}>
          {children}
        </div>
      </form>
    </FormStateContext.Provider>
  );
}

export function useFormState() {
  return useContext(FormStateContext);
}

function FormMessage() {
  const state = useFormState();
  if (!state) return null;
  if (state.ok && state.message) {
    return (
      <p role="status" className="mb-3 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
        {state.message}
      </p>
    );
  }
  if (!state.ok && state.error) {
    const existing = state.details?.existingItemId as string | undefined;
    return (
      <div role="alert" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {state.error}
        {existing && (
          <>
            {" "}
            <a className="font-medium underline" href={`/equipment/${existing}`}>
              Open existing item
            </a>
          </>
        )}
      </div>
    );
  }
  return null;
}

export function SubmitButton({
  children,
  variant = "primary",
  className,
  pendingText,
  ...rest
}: ComponentProps<"button"> & { variant?: keyof typeof buttonVariants; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(buttonVariants[variant], className)} {...rest}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

function useField(name: string, defaultValue?: string | number | null) {
  const state = useFormState();
  const error = state?.fieldErrors?.[name];
  const value = state && !state.ok && state.values && name in state.values ? state.values[name] : (defaultValue ?? "");
  return { error, value: value === null ? "" : String(value) };
}

function FieldShell({ label, id, error, hint, children, className }: { label?: string; id: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  name,
  id = name,
  defaultValue,
  hint,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "defaultValue"> & { label?: string; name: string; defaultValue?: string | number | null; hint?: ReactNode }) {
  const { error, value } = useField(name, defaultValue);
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <input
        id={id}
        name={name}
        defaultValue={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn("input", error && "border-danger")}
        {...rest}
      />
    </FieldShell>
  );
}

export function TextArea({
  label,
  name,
  id = name,
  defaultValue,
  hint,
  className,
  ...rest
}: Omit<ComponentProps<"textarea">, "defaultValue"> & { label?: string; name: string; defaultValue?: string | null; hint?: ReactNode }) {
  const { error, value } = useField(name, defaultValue);
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <textarea id={id} name={name} defaultValue={value} rows={3} className={cn("input", error && "border-danger")} {...rest} />
    </FieldShell>
  );
}

export function Select({
  label,
  name,
  id = name,
  defaultValue,
  options,
  placeholder,
  hint,
  className,
  ...rest
}: Omit<ComponentProps<"select">, "defaultValue"> & {
  label?: string;
  name: string;
  defaultValue?: string | null;
  options: { value: string; label: string }[];
  placeholder?: string;
  hint?: ReactNode;
}) {
  const { error, value } = useField(name, defaultValue);
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <select id={id} name={name} defaultValue={value} className={cn("input", error && "border-danger")} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { CONDITION_LABEL, PROJECT_STATUS_LABEL, STATUS_LABEL, cn } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm text-muted hover:text-text">
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 border-b border-border px-4 py-3", className)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";
export const buttonVariants = {
  primary: `${buttonBase} bg-accent text-accent-fg hover:brightness-110`,
  secondary: `${buttonBase} border border-border bg-surface text-text hover:bg-surface-2`,
  ghost: `${buttonBase} text-text hover:bg-surface-2`,
  danger: `${buttonBase} border border-danger/40 text-danger hover:bg-danger/10`,
};

export function LinkButton({
  variant = "secondary",
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonVariants }) {
  return <Link className={cn(buttonVariants[variant], className)} {...rest} />;
}

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info" | "violet";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
};

const STATUS_TONE: Record<string, Tone> = {
  available: "neutral",
  on_project: "info",
  in_use: "ok",
  ready_for_return: "violet",
  missing: "danger",
  returned: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

const CONDITION_COLOR: Record<string, string> = {
  unknown: "bg-muted/50",
  ok: "bg-ok",
  minor_wear: "bg-warn",
  damaged: "bg-orange-500",
  defective: "bg-danger",
};

export function ConditionBadge({ condition, hideOk }: { condition: string; hideOk?: boolean }) {
  if (hideOk && (condition === "ok" || condition === "unknown")) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
      <span className={cn("size-2 rounded-full", CONDITION_COLOR[condition])} aria-hidden />
      {CONDITION_LABEL[condition] ?? condition}
    </span>
  );
}

const PROJECT_TONE: Record<string, Tone> = { planning: "neutral", prep: "info", shooting: "ok", wrap: "violet", closed: "neutral" };
export function ProjectStatusBadge({ status }: { status: string }) {
  return <Badge tone={PROJECT_TONE[status] ?? "neutral"}>{PROJECT_STATUS_LABEL[status] ?? status}</Badge>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, tone, href }: { label: string; value: ReactNode; tone?: "danger" | "warn"; href?: string }) {
  const body = (
    <>
      <div className={cn("text-2xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </>
  );
  const cls = "rounded-xl border border-border bg-surface px-4 py-3";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-ring/60")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; count?: number; key: string }[]; active: string }) {
  return (
    <nav className="-mx-4 mb-4 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0" aria-label="Sections">
      <ul className="flex gap-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                t.key === active ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="rounded bg-surface-2 px-1.5 text-xs text-muted">{t.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function KeyValues({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((i) => (
        <div key={i.label} className="contents">
          <dt className="text-muted">{i.label}</dt>
          <dd className="min-w-0 break-words">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}

export function NoPermission() {
  return (
    <EmptyState title="No permission">
      Your role in this workspace does not allow this action. Ask a workspace admin.
    </EmptyState>
  );
}

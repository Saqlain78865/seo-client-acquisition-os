import * as React from "react";
import { cn } from "@/lib/utils";

// ───────────── Button ─────────────

const buttonVariants = {
  primary: "bg-primary text-white shadow-sm shadow-primary/25 hover:bg-primary-hover hover:shadow-md hover:shadow-primary/30",
  secondary: "bg-surface text-text border border-border shadow-sm hover:border-primary/30 hover:bg-surface-2",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-danger text-white shadow-sm hover:opacity-90",
  link: "text-primary hover:underline px-0",
} as const;

const buttonSizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-sm",
  icon: "h-10 w-10",
} as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

export function buttonClass(variant: keyof typeof buttonVariants = "primary", size: keyof typeof buttonSizes = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
    buttonVariants[variant],
    buttonSizes[size],
  );
}

export function Button({ className, variant = "primary", size = "md", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonClass(variant, size), className)} {...props} />;
}

// ───────────── Tabs ─────────────

/** Segmented tab bar: wrap tab links/buttons (role="tab") in an element with this class. */
export const tabBarClass =
  "inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-border bg-surface/80 p-1 shadow-card backdrop-blur";

export function tabClass(active: boolean) {
  return cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-sm font-medium transition-all duration-150",
    active ? "bg-gradient-to-r from-primary to-accent text-white shadow-md shadow-primary/25" : "text-muted hover:bg-surface-2 hover:text-text",
  );
}

// ───────────── Form controls ─────────────

const controlClass =
  "w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-text shadow-[inset_0_1px_1px_rgb(16_24_40/0.03)] transition-[border-color,box-shadow] placeholder:text-muted/60 hover:border-primary/30 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClass, "min-h-24 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlClass, "h-10 pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-text", className)} {...props} />;
}

/** Label + control + hint/error, wired up with ids for screen readers. */
export function Field({
  label,
  name,
  id: idProp,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  name: string;
  /** DOM id; defaults to `name`. Set it when two forms on one page share field names. */
  id?: string;
  error?: string[] | string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; name?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  const id = idProp ?? name;
  const describedBy = message ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </Label>
      {React.cloneElement(children, {
        id,
        name,
        "aria-invalid": message ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {message ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {message}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ───────────── Surfaces ─────────────

/** `interactive` lifts the card on hover — use it for cards that are links. */
export function Card({ className, interactive, ...props }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface shadow-card",
        interactive && "transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-text">{title}</h2>
        {/* A div, not a p: descriptions may contain block elements such as status lines. */}
        {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-[1.7rem]">{title}</h1>
        {description && <div className="mt-1.5 max-w-3xl text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ───────────── Badge ─────────────

const badgeTones = {
  neutral: "bg-surface-2 text-muted border-border",
  primary: "bg-primary-soft text-primary border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
} as const;
export type BadgeTone = keyof typeof badgeTones;

/** `dot` adds a small status dot in the badge colour. */
export function Badge({ tone = "neutral", dot, className, children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

// ───────────── Avatar ─────────────

const AVATAR_TONES = [
  "from-[#6366f1] to-[#8b5cf6]",
  "from-[#0ea5e9] to-[#6366f1]",
  "from-[#10b981] to-[#0d9488]",
  "from-[#f59e0b] to-[#f97316]",
  "from-[#ec4899] to-[#8b5cf6]",
  "from-[#14b8a6] to-[#0ea5e9]",
];

/** Initials on a colour picked from the name, so each business keeps its colour. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-bold text-white shadow-sm", AVATAR_TONES[hash % AVATAR_TONES.length], className)} aria-hidden>
      {initials}
    </span>
  );
}

// ───────────── Feedback ─────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 rounded-2xl bg-gradient-to-br from-primary-soft to-surface-2 p-3.5 text-primary ring-1 ring-primary/10">{icon}</div>}
      <p className="text-sm font-semibold text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info/30 bg-info-soft text-info",
    warning: "border-warning/30 bg-warning-soft text-warning",
    danger: "border-danger/30 bg-danger-soft text-danger",
    success: "border-success/30 bg-success-soft text-success",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-0.5", "text-text/80")}>{children}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-surface-2", className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/5" />
    </div>
  );
}

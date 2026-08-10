import { Link, useRouterState } from "@tanstack/react-router";

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  DISCOVERED: { label: "Discovered", tone: "text-muted-foreground" },
  WAITING: { label: "Waiting", tone: "text-muted-foreground" },
  QUEUED: { label: "Queued", tone: "text-info" },
  OCR_PROCESSING: { label: "OCR", tone: "text-accent" },
  EXTRACTION_PROCESSING: { label: "Extracting", tone: "text-accent" },
  COMPLETED: { label: "Completed", tone: "text-ok" },
  FAILED: { label: "Failed", tone: "text-destructive" },
};

export function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "text-muted-foreground" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-widest ${meta.tone}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/review", label: "Review" },
  { to: "/settings", label: "Settings" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
              S
            </span>
            <span>
              <span className="block font-mono text-sm font-semibold tracking-[0.18em] uppercase">
                Scanner OCR
              </span>
              <span className="label-caps">Document ingestion console</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active =
                item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`rounded-md px-3 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors ${
                    active
                      ? "bg-secondary text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

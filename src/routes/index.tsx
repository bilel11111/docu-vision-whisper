import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { AppShell, StatusPill } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { runIngest, runQueue } from "@/lib/scanner.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scanner OCR Console — Document Ingestion Dashboard" },
      {
        name: "description",
        content:
          "Watch your scanner folder, run vLLM OCR on single and multi-page scans, and track extracted document data.",
      },
      { property: "og:title", content: "Scanner OCR Console — Document Ingestion Dashboard" },
      {
        property: "og:description",
        content:
          "Watch your scanner folder, run vLLM OCR on single and multi-page scans, and track extracted document data.",
      },
    ],
  }),
  component: Dashboard,
});

type DocumentRow = {
  id: string;
  reference: string;
  scan_date: string | null;
  month: string | null;
  day: string | null;
  page_count: number;
  status: string;
  confidence: number | null;
  reviewed: boolean;
  source_path: string;
  error_message: string | null;
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="label-caps">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const ingest = useServerFn(runIngest);
  const queue = useServerFn(runQueue);

  const documents = useQuery({
    queryKey: ["documents"],
    refetchInterval: 5000,
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select(
          "id,reference,scan_date,month,day,page_count,status,confidence,reviewed,source_path,error_message",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentRow[];
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => ingest({ data: undefined }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Found ${res.scanned} documents · ${res.created} new · ${res.waiting} still being written`,
      );
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const queueMutation = useMutation({
    mutationFn: () => queue({ data: { limit: 5 } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Processed ${res.done} document(s) · ${res.failed} failed`);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = documents.data ?? [];
  const counts = {
    total: rows.length,
    completed: rows.filter((r) => r.status === "COMPLETED").length,
    processing: rows.filter((r) =>
      ["QUEUED", "OCR_PROCESSING", "EXTRACTION_PROCESSING"].includes(r.status),
    ).length,
    failed: rows.filter((r) => r.status === "FAILED").length,
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold tracking-tight uppercase">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan the folder tree, then run the OCR queue against your vLLM server.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            {scanMutation.isPending ? "Scanning…" : "Scan folder"}
          </Button>
          <Button onClick={() => queueMutation.mutate()} disabled={queueMutation.isPending}>
            {queueMutation.isPending ? "Processing…" : "Process queue"}
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Documents" value={counts.total} />
        <Stat label="Completed" value={counts.completed} tone="text-ok" />
        <Stat label="In pipeline" value={counts.processing} tone="text-accent" />
        <Stat label="Failed" value={counts.failed} tone="text-destructive" />
      </div>

      <section className="panel mt-5 overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="label-caps">Recent documents</h2>
          {documents.isFetching ? <span className="label-caps">Syncing</span> : null}
        </header>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No documents yet. Press <span className="font-mono text-foreground">Scan folder</span> to
            read your scanner directory.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((doc) => (
              <li key={doc.id}>
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: doc.id }}
                  className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-secondary sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">
                      REF {doc.reference}
                      <span className="ml-2 text-muted-foreground">
                        {doc.page_count} page{doc.page_count > 1 ? "s" : ""}
                      </span>
                    </p>
                    <p className="truncate font-mono text-[0.7rem] text-muted-foreground">
                      {doc.source_path}
                    </p>
                    {doc.error_message ? (
                      <p className="mt-1 truncate font-mono text-[0.7rem] text-destructive">
                        {doc.error_message}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {doc.scan_date ?? [doc.month, doc.day].filter(Boolean).join(" / ") ?? "—"}
                    </span>
                    {doc.confidence != null ? (
                      <span
                        className={`font-mono text-xs ${
                          doc.confidence < 0.85 ? "text-warn" : "text-ok"
                        }`}
                      >
                        {Math.round(doc.confidence * 100)}%
                      </span>
                    ) : null}
                    <StatusPill status={doc.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

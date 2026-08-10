import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { AppShell, StatusPill } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review Queue — Scanner OCR Console" },
      {
        name: "description",
        content:
          "Documents with low extraction confidence or failures, waiting for a human to correct and approve the data.",
      },
      { property: "og:title", content: "Review Queue — Scanner OCR Console" },
      {
        property: "og:description",
        content: "Correct low-confidence OCR extractions before they become final.",
      },
    ],
  }),
  component: ReviewQueue,
});

type Row = {
  id: string;
  reference: string;
  scan_date: string | null;
  status: string;
  confidence: number | null;
  page_count: number;
  reviewed: boolean;
  source_path: string;
};

function ReviewQueue() {
  const rows = useQuery({
    queryKey: ["review-queue"],
    refetchInterval: 8000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("id,reference,scan_date,status,confidence,page_count,reviewed,source_path")
        .eq("reviewed", false)
        .order("confidence", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).filter(
        (r) => r.status === "FAILED" || (r.confidence != null && r.confidence < 0.85),
      );
    },
  });

  const list = rows.data ?? [];

  return (
    <AppShell>
      <h1 className="font-mono text-xl font-semibold uppercase">Review queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Failed documents and extractions below 85% average confidence.
      </p>

      <section className="panel mt-5 overflow-hidden">
        {list.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing needs review right now.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((doc) => (
              <li key={doc.id}>
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: doc.id }}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-secondary"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">REF {doc.reference}</p>
                    <p className="truncate font-mono text-[0.7rem] text-muted-foreground">
                      {doc.source_path}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {doc.confidence != null ? (
                      <span className="font-mono text-xs text-warn">
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

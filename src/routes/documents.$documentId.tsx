import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, StatusPill } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { runDocument } from "@/lib/scanner.functions";

export const Route = createFileRoute("/documents/$documentId")({
  head: () => ({
    meta: [
      { title: "Document Detail — Scanner OCR Console" },
      {
        name: "description",
        content:
          "Inspect scanned pages, OCR text and extracted fields for one document, then correct and approve the extraction.",
      },
      { property: "og:title", content: "Document Detail — Scanner OCR Console" },
      {
        property: "og:description",
        content: "Review OCR output page by page and approve corrected structured data.",
      },
    ],
  }),
  component: DocumentDetail,
});

type Field = { value: string | null; confidence: number | null };

type DocRow = {
  id: string;
  reference: string;
  source_path: string;
  scan_date: string | null;
  month: string | null;
  day: string | null;
  status: string;
  page_count: number;
  ocr_text: string | null;
  extracted: Record<string, Field> | null;
  confidence: number | null;
  reviewed: boolean;
  error_message: string | null;
};

type PageRow = {
  id: string;
  page_number: number;
  file_path: string;
  is_main: boolean;
  ocr_text: string | null;
  ocr_status: string;
};

const imageUrl = (p: string) => `/api/page-image?path=${encodeURIComponent(p)}`;

function DocumentDetail() {
  const { documentId } = Route.useParams();
  const queryClient = useQueryClient();
  const process = useServerFn(runDocument);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const doc = useQuery({
    queryKey: ["document", documentId],
    refetchInterval: 5000,
    queryFn: async (): Promise<{ document: DocRow; pages: PageRow[] }> => {
      const [{ data: document, error }, { data: pages, error: pagesError }] = await Promise.all([
        supabase.from("documents").select("*").eq("id", documentId).single(),
        supabase
          .from("document_pages")
          .select("*")
          .eq("document_id", documentId)
          .order("page_number"),
      ]);
      if (error) throw new Error(error.message);
      if (pagesError) throw new Error(pagesError.message);
      return { document: document as DocRow, pages: (pages ?? []) as PageRow[] };
    },
  });

  const extracted = doc.data?.document.extracted ?? null;

  useEffect(() => {
    if (!extracted) return;
    setDraft(
      Object.fromEntries(Object.entries(extracted).map(([k, v]) => [k, v?.value ?? ""])),
    );
  }, [extracted]);

  const reprocess = useMutation({
    mutationFn: () => process({ data: { documentId } }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error ?? "Processing failed");
      else toast.success("Document processed");
      void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const approve = useMutation({
    mutationFn: async () => {
      const merged: Record<string, Field> = {};
      for (const [key, value] of Object.entries(draft)) {
        merged[key] = {
          value: value.trim() === "" ? null : value,
          confidence: extracted?.[key]?.confidence ?? null,
        };
      }
      const { error } = await supabase
        .from("documents")
        .update({ extracted: merged, reviewed: true })
        .eq("id", documentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Extraction approved");
      void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (doc.isLoading) {
    return (
      <AppShell>
        <p className="label-caps">Loading document…</p>
      </AppShell>
    );
  }

  if (doc.error || !doc.data) {
    return (
      <AppShell>
        <p className="text-sm text-destructive">
          {doc.error instanceof Error ? doc.error.message : "Document not found"}
        </p>
      </AppShell>
    );
  }

  const { document, pages } = doc.data;

  return (
    <AppShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link to="/" className="label-caps hover:text-foreground">
            ← Back to dashboard
          </Link>
          <h1 className="mt-2 font-mono text-xl font-semibold uppercase">
            Document {document.reference}
          </h1>
          <p className="truncate font-mono text-xs text-muted-foreground">{document.source_path}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusPill status={document.status} />
          <Button
            variant="secondary"
            onClick={() => reprocess.mutate()}
            disabled={reprocess.isPending}
          >
            {reprocess.isPending ? "Running OCR…" : "Run OCR"}
          </Button>
        </div>
      </div>

      {document.error_message ? (
        <p className="panel mt-4 px-4 py-3 font-mono text-xs text-destructive">
          {document.error_message}
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <section className="panel overflow-hidden">
          <header className="border-b border-border px-4 py-3">
            <h2 className="label-caps">Pages ({pages.length})</h2>
          </header>
          <div className="grid gap-4 p-4">
            {pages.map((page) => (
              <figure key={page.id} className="space-y-2">
                <figcaption className="flex items-center justify-between">
                  <span className="font-mono text-xs">
                    Page {page.page_number}
                    {page.is_main ? <span className="ml-2 text-primary">main</span> : null}
                  </span>
                  <span className="label-caps">{page.ocr_status}</span>
                </figcaption>
                <img
                  src={imageUrl(page.file_path)}
                  alt={`Scanned page ${page.page_number} of document ${document.reference}`}
                  loading="lazy"
                  className="w-full rounded-md border border-border bg-muted object-contain"
                />
                <p className="font-mono text-[0.7rem] break-all text-muted-foreground">
                  {page.file_path}
                </p>
              </figure>
            ))}
          </div>
        </section>

        <div className="flex flex-col gap-5">
          <section className="panel">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="label-caps">Extracted data</h2>
              {document.confidence != null ? (
                <span
                  className={`font-mono text-xs ${
                    document.confidence < 0.85 ? "text-warn" : "text-ok"
                  }`}
                >
                  {Math.round(document.confidence * 100)}% avg
                </span>
              ) : null}
            </header>
            {extracted ? (
              <div className="space-y-3 p-4">
                {Object.entries(extracted).map(([key, field]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="label-caps" htmlFor={`field-${key}`}>
                        {key.replace(/_/g, " ")}
                      </label>
                      {field?.confidence != null ? (
                        <span
                          className={`font-mono text-[0.7rem] ${
                            field.confidence < 0.85 ? "text-warn" : "text-ok"
                          }`}
                        >
                          {Math.round(field.confidence * 100)}%
                          {field.confidence < 0.85 ? " review" : ""}
                        </span>
                      ) : null}
                    </div>
                    <Input
                      id={`field-${key}`}
                      value={draft[key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      className="font-mono"
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <span className="label-caps">
                    {document.reviewed ? "Approved" : "Not reviewed"}
                  </span>
                  <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                    {approve.isPending ? "Saving…" : "Save & approve"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No extraction yet — run OCR for this document.
              </p>
            )}
          </section>

          <section className="panel">
            <header className="border-b border-border px-4 py-3">
              <h2 className="label-caps">Combined OCR text</h2>
            </header>
            <pre className="max-h-96 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {document.ocr_text ?? "—"}
            </pre>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

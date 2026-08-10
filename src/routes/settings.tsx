import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchSettings,
  previewScannerTree,
  saveSettings,
  testConnection,
} from "@/lib/scanner.functions";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Pipeline Settings — Scanner OCR Console" },
      {
        name: "description",
        content:
          "Configure the vLLM endpoint, model, scanner directory, OCR prompt and the fields extracted from each scanned document.",
      },
      { property: "og:title", content: "Pipeline Settings — Scanner OCR Console" },
      {
        property: "og:description",
        content: "Point the pipeline at your vLLM server and scanner folder without touching code.",
      },
    ],
  }),
  component: SettingsPage,
});

type Form = {
  vllm_url: string;
  vllm_model: string;
  scanner_dir: string;
  ocr_prompt: string;
  extraction_fields: string;
};

function SettingsPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(fetchSettings);
  const save = useServerFn(saveSettings);
  const test = useServerFn(testConnection);
  const preview = useServerFn(previewScannerTree);

  const [form, setForm] = useState<Form | null>(null);
  const [models, setModels] = useState<string[] | null>(null);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => load({ data: undefined }) });

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      vllm_url: settings.data.vllm_url,
      vllm_model: settings.data.vllm_model,
      scanner_dir: settings.data.scanner_dir,
      ocr_prompt: settings.data.ocr_prompt,
      extraction_fields: settings.data.extraction_fields.join(", "),
    });
  }, [settings.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const res = await save({
        data: {
          vllm_url: form.vllm_url.trim(),
          vllm_model: form.vllm_model.trim(),
          scanner_dir: form.scanner_dir.trim(),
          ocr_prompt: form.ocr_prompt.trim(),
          extraction_fields: form.extraction_fields
            .split(",")
            .map((f) => f.trim().replace(/\s+/g, "_").toLowerCase())
            .filter(Boolean),
        },
      });
      return res;
    },
    onSuccess: () => {
      toast.success("Settings saved");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: () => test({ data: { vllm_url: form?.vllm_url.trim() ?? "" } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setModels(null);
        toast.error(`vLLM unreachable: ${res.error}`);
        return;
      }
      setModels(res.models);
      toast.success(`Connected · ${res.models.length} model(s) available`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const previewMutation = useMutation({
    mutationFn: () => preview({ data: undefined }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
      else toast.success(`${res.total} document(s) detected under ${res.root}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!form) {
    return (
      <AppShell>
        <p className="label-caps">Loading settings…</p>
      </AppShell>
    );
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <AppShell>
      <h1 className="font-mono text-xl font-semibold uppercase">Pipeline settings</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Everything the pipeline needs lives here — no code changes when your document format or
        server address changes.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="panel space-y-4 p-4">
          <h2 className="label-caps">Inference server</h2>
          <div className="space-y-1">
            <label className="label-caps" htmlFor="vllm-url">
              vLLM base URL
            </label>
            <Input
              id="vllm-url"
              className="font-mono"
              value={form.vllm_url}
              onChange={(e) => set({ vllm_url: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label-caps" htmlFor="vllm-model">
              Model name
            </label>
            <Input
              id="vllm-model"
              className="font-mono"
              placeholder="e.g. Qwen/Qwen2.5-VL-7B-Instruct"
              value={form.vllm_model}
              onChange={(e) => set({ vllm_model: e.target.value })}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? "Testing…" : "Test connection"}
          </Button>
          {models ? (
            <ul className="space-y-1">
              {models.map((m) => (
                <li key={m} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs">{m}</span>
                  <button
                    type="button"
                    className="label-caps hover:text-primary"
                    onClick={() => set({ vllm_model: m })}
                  >
                    use
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel space-y-4 p-4">
          <h2 className="label-caps">Scanner directory</h2>
          <div className="space-y-1">
            <label className="label-caps" htmlFor="scanner-dir">
              Root folder (on the machine running this app)
            </label>
            <Input
              id="scanner-dir"
              className="font-mono"
              value={form.scanner_dir}
              onChange={(e) => set({ scanner_dir: e.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The parser walks month → day → reference. A loose image is a single-page document; a
            folder of images is one multi-page document, with the file matching the folder name as
            page 1.
          </p>
          <Button
            variant="secondary"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending ? "Reading…" : "Preview detection"}
          </Button>
          {previewMutation.data?.ok ? (
            <ul className="max-h-56 space-y-1 overflow-auto">
              {previewMutation.data.documents.map((d) => (
                <li key={d.sourcePath} className="font-mono text-[0.7rem] text-muted-foreground">
                  <span className="text-foreground">REF {d.reference}</span> · {d.pageCount}p ·{" "}
                  {d.scanDate ?? "no date"} · {d.sourcePath}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel space-y-4 p-4 lg:col-span-2">
          <h2 className="label-caps">OCR prompt (stage 1)</h2>
          <Textarea
            className="min-h-32 font-mono text-xs"
            value={form.ocr_prompt}
            onChange={(e) => set({ ocr_prompt: e.target.value })}
          />
          <div className="space-y-1">
            <label className="label-caps" htmlFor="fields">
              Fields to extract (stage 2, comma separated)
            </label>
            <Input
              id="fields"
              className="font-mono"
              value={form.extraction_fields}
              onChange={(e) => set({ extraction_fields: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Each field is returned with a confidence score; anything under 85% is flagged for
              review.
            </p>
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save settings"}
          </Button>
        </section>
      </div>
    </AppShell>
  );
}

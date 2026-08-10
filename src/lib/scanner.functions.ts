import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  ingestScannerDirectory,
  listVllmModels,
  loadSettings,
  processDocument,
  processQueue,
  getServerSupabase,
  scanTree,
} from "./scanner.server";

export const fetchSettings = createServerFn({ method: "GET" }).handler(async () => {
  return loadSettings();
});

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        vllm_url: z.string().min(1),
        vllm_model: z.string(),
        scanner_dir: z.string().min(1),
        ocr_prompt: z.string().min(1),
        extraction_fields: z.array(z.string().min(1)),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = getServerSupabase();
    const { error } = await supabase.from("app_settings").update(data).eq("id", "default");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testConnection = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ vllm_url: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    try {
      const models = await listVllmModels(data.vllm_url);
      return { ok: true as const, models };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const previewScannerTree = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const settings = await loadSettings();
    const docs = await scanTree(settings.scanner_dir);
    return {
      ok: true as const,
      root: settings.scanner_dir,
      documents: docs.slice(0, 100).map((d) => ({
        reference: d.reference,
        sourcePath: d.sourcePath,
        month: d.month,
        day: d.day,
        scanDate: d.scanDate,
        pageCount: d.pages.length,
      })),
      total: docs.length,
    };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
});

export const runIngest = createServerFn({ method: "POST" }).handler(async () => {
  try {
    return { ok: true as const, ...(await ingestScannerDirectory()) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
});

export const runQueue = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(25).default(5) }).parse(input),
  )
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, ...(await processQueue(data.limit)) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const runDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    try {
      return await processDocument(data.documentId);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

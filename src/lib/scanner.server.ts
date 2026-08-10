import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"];

export type ParsedDocument = {
  reference: string;
  sourcePath: string;
  month: string | null;
  day: string | null;
  scanDate: string | null;
  pages: string[];
};

export function getServerSupabase(): SupabaseClient {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Backend credentials unavailable on the server");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Settings = {
  vllm_url: string;
  vllm_model: string;
  scanner_dir: string;
  ocr_prompt: string;
  extraction_fields: string[];
};

export async function loadSettings(): Promise<Settings> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Settings row missing");
  return {
    vllm_url: data.vllm_url,
    vllm_model: data.vllm_model,
    scanner_dir: data.scanner_dir,
    ocr_prompt: data.ocr_prompt,
    extraction_fields: Array.isArray(data.extraction_fields)
      ? (data.extraction_fields as string[])
      : [],
  };
}

const isImage = (name: string) => IMAGE_EXTS.includes(path.extname(name).toLowerCase());
const isTemp = (name: string) => name.startsWith(".") || name.startsWith("~") || name.endsWith(".tmp");

/** Natural sort so 07.jpg < 07_01.jpg < 07_02.jpg < 07_10.jpg */
function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function deriveDateParts(root: string, target: string) {
  const rel = path.relative(root, target);
  const segments = rel.split(/[\\/]/).filter(Boolean);
  // last segment is the document itself (file or folder)
  const chain = segments.slice(0, -1);
  const day = chain.length >= 1 ? chain[chain.length - 1] : null;
  const month = chain.length >= 2 ? chain[chain.length - 2] : null;
  const year = chain.length >= 3 ? chain[chain.length - 3] : null;
  return {
    month: month ?? null,
    day: day ?? null,
    scanDate: buildDate(year ?? null, month ?? null, day ?? null),
  };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function buildDate(year: string | null | undefined | string, month: string | null, day: string | null) {
  if (!month || !day) return null;
  const dayNum = Number(day.match(/\d+/)?.[0]);
  if (!dayNum || dayNum > 31) return null;
  const cleaned = month.toLowerCase();
  let monthNum = Number(cleaned.match(/\d+/)?.[0] ?? NaN);
  if (!monthNum || monthNum > 12) {
    const idx = MONTHS.findIndex((m) => cleaned.includes(m));
    if (idx === -1) return null;
    monthNum = idx + 1;
  }
  const yearNum = Number(year?.match(/\d{4}/)?.[0] ?? new Date().getFullYear());
  return `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
}

/**
 * Walks the scanner tree. A directory whose direct children include images and
 * no image-bearing sub-directory is treated as a multi-page document folder.
 * Loose image files anywhere else are single-page documents.
 */
export async function scanTree(root: string): Promise<ParsedDocument[]> {
  const docs: ParsedDocument[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    const files = entries.filter((e) => e.isFile() && isImage(e.name) && !isTemp(e.name));
    const dirs = entries.filter((e) => e.isDirectory() && !isTemp(e.name));

    const imageBearingSubdirs: string[] = [];
    for (const d of dirs) {
      const sub = path.join(dir, d.name);
      if (await dirHasImages(sub)) imageBearingSubdirs.push(sub);
    }

    const isDocumentFolder = dir !== root && files.length > 0 && imageBearingSubdirs.length === 0;

    if (isDocumentFolder) {
      const reference = path.basename(dir);
      const names = files.map((f) => f.name).sort(naturalCompare);
      const main = names.find((n) => path.parse(n).name === reference);
      const ordered = main ? [main, ...names.filter((n) => n !== main)] : names;
      docs.push({
        reference,
        sourcePath: dir,
        ...deriveDateParts(root, dir),
        pages: ordered.map((n) => path.join(dir, n)),
      });
    } else {
      for (const f of files) {
        const full = path.join(dir, f.name);
        docs.push({
          reference: path.parse(f.name).name,
          sourcePath: full,
          ...deriveDateParts(root, full),
          pages: [full],
        });
      }
    }

    for (const d of dirs) {
      const sub = path.join(dir, d.name);
      if (!isDocumentFolder) await walk(sub);
    }
  }

  async function dirHasImages(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      if (entries.some((e) => e.isFile() && isImage(e.name) && !isTemp(e.name))) return true;
      for (const e of entries.filter((x) => x.isDirectory())) {
        if (await dirHasImages(path.join(dir, e.name))) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  await walk(root);
  return docs;
}

/** A file is considered written when its size stops changing. */
export async function isStable(file: string, waitMs = 1500) {
  try {
    const a = await fs.stat(file);
    await new Promise((r) => setTimeout(r, waitMs));
    const b = await fs.stat(file);
    return a.size === b.size && b.size > 0;
  } catch {
    return false;
  }
}

export async function documentIsStable(pages: string[]) {
  for (const p of pages) {
    if (!(await isStable(p))) return false;
  }
  return true;
}

function mimeFor(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "image/jpeg";
}

export async function readImageDataUrl(file: string) {
  const buf = await fs.readFile(file);
  return `data:${mimeFor(file)};base64,${buf.toString("base64")}`;
}

function chatUrl(base: string) {
  return `${base.replace(/\/+$/, "")}/chat/completions`;
}

async function callVllm(settings: Settings, messages: unknown[], temperature = 0) {
  const res = await fetch(chatUrl(settings.vllm_url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer EMPTY" },
    body: JSON.stringify({ model: settings.vllm_model, messages, temperature, max_tokens: 4096 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`vLLM ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function listVllmModels(base: string) {
  const res = await fetch(`${base.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: "Bearer EMPTY" },
  });
  if (!res.ok) throw new Error(`vLLM ${res.status}`);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id);
}

/** Stage 1 — OCR a single page image. */
export async function ocrPage(settings: Settings, file: string) {
  const dataUrl = await readImageDataUrl(file);
  return callVllm(settings, [
    {
      role: "user",
      content: [
        { type: "text", text: settings.ocr_prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ]);
}

function parseJsonBlock(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

export type ExtractedField = { value: string | null; confidence: number | null };

/** Stage 2 — structured extraction from the combined OCR text. */
export async function extractFields(settings: Settings, ocrText: string) {
  const fields = settings.extraction_fields;
  const schema = fields
    .map((f) => `  "${f}": { "value": <string or null>, "confidence": <0..1> }`)
    .join(",\n");
  const prompt = [
    "You extract structured data from OCR text of a scanned document.",
    "Return ONLY valid JSON in exactly this shape:",
    "{",
    schema,
    "}",
    "Rules: never invent information; if a field is absent use null with confidence 0.",
    "Dates must be normalised to YYYY-MM-DD. Amounts must be plain numbers without currency symbols.",
    "",
    "OCR TEXT:",
    ocrText,
  ].join("\n");

  const raw = await callVllm(settings, [{ role: "user", content: prompt }]);
  const parsed = parseJsonBlock(raw) as Record<string, unknown>;
  const result: Record<string, ExtractedField> = {};
  for (const f of fields) {
    const entry = parsed[f];
    if (entry && typeof entry === "object" && "value" in (entry as object)) {
      const e = entry as { value: unknown; confidence?: unknown };
      result[f] = {
        value: e.value == null ? null : String(e.value),
        confidence: typeof e.confidence === "number" ? e.confidence : null,
      };
    } else {
      result[f] = {
        value: entry == null ? null : String(entry),
        confidence: entry == null ? 0 : null,
      };
    }
  }
  return result;
}

export function averageConfidence(fields: Record<string, ExtractedField>) {
  const vals = Object.values(fields)
    .map((f) => f.confidence)
    .filter((c): c is number => typeof c === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Discover new documents on disk and register them in the database. */
export async function ingestScannerDirectory() {
  const settings = await loadSettings();
  const supabase = getServerSupabase();

  try {
    await fs.access(settings.scanner_dir);
  } catch {
    throw new Error(
      `Scanner directory not reachable from this server: ${settings.scanner_dir}. Run the app on the scanner machine.`,
    );
  }

  const found = await scanTree(settings.scanner_dir);
  const { data: existing, error } = await supabase.from("documents").select("source_path");
  if (error) throw new Error(error.message);
  const known = new Set((existing ?? []).map((d) => d.source_path));

  let created = 0;
  let waiting = 0;

  for (const doc of found) {
    if (known.has(doc.sourcePath)) continue;
    if (!(await documentIsStable(doc.pages))) {
      waiting++;
      continue;
    }
    const { data: inserted, error: insErr } = await supabase
      .from("documents")
      .insert({
        reference: doc.reference,
        month: doc.month,
        day: doc.day,
        scan_date: doc.scanDate,
        source_path: doc.sourcePath,
        page_count: doc.pages.length,
        status: "QUEUED",
      })
      .select("id")
      .single();
    if (insErr || !inserted) continue;

    await supabase.from("document_pages").insert(
      doc.pages.map((p, i) => ({
        document_id: inserted.id,
        page_number: i + 1,
        file_path: p,
        is_main: i === 0,
      })),
    );
    created++;
  }

  return { scanned: found.length, created, waiting };
}

/** Run the OCR + extraction pipeline for one document. */
export async function processDocument(documentId: string) {
  const settings = await loadSettings();
  const supabase = getServerSupabase();

  const { data: pages, error: pagesErr } = await supabase
    .from("document_pages")
    .select("*")
    .eq("document_id", documentId)
    .order("page_number");
  if (pagesErr) throw new Error(pagesErr.message);
  if (!pages?.length) throw new Error("Document has no pages");

  try {
    await supabase.from("documents").update({ status: "OCR_PROCESSING" }).eq("id", documentId);

    const chunks: string[] = [];
    for (const page of pages) {
      await supabase
        .from("document_pages")
        .update({ ocr_status: "PROCESSING" })
        .eq("id", page.id);
      const text = await ocrPage(settings, page.file_path);
      await supabase
        .from("document_pages")
        .update({ ocr_text: text, ocr_status: "DONE" })
        .eq("id", page.id);
      chunks.push(`[PAGE ${page.page_number}]\n${text}`);
    }

    const combined = chunks.join("\n\n");
    await supabase
      .from("documents")
      .update({ ocr_text: combined, status: "EXTRACTION_PROCESSING" })
      .eq("id", documentId);

    const fields = await extractFields(settings, combined);
    await supabase
      .from("documents")
      .update({
        extracted: fields,
        confidence: averageConfidence(fields),
        document_type: fields["document_type"]?.value ?? null,
        status: "COMPLETED",
        error_message: null,
      })
      .eq("id", documentId);

    return { ok: true as const, fields };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { data: current } = await supabase
      .from("documents")
      .select("retry_count")
      .eq("id", documentId)
      .maybeSingle();
    await supabase
      .from("documents")
      .update({
        status: "FAILED",
        error_message: message,
        retry_count: (current?.retry_count ?? 0) + 1,
      })
      .eq("id", documentId);
    return { ok: false as const, error: message };
  }
}

export async function processQueue(limit: number) {
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from("documents")
    .select("id")
    .in("status", ["QUEUED", "FAILED"])
    .order("created_at")
    .limit(limit);
  let done = 0;
  let failed = 0;
  for (const doc of data ?? []) {
    const res = await processDocument(doc.id);
    if (res.ok) done++;
    else failed++;
  }
  return { done, failed };
}

export async function readPageFile(filePath: string) {
  const settings = await loadSettings();
  const root = path.resolve(settings.scanner_dir);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root)) throw new Error("Path outside scanner directory");
  const buf = await fs.readFile(resolved);
  return { buf, mime: mimeFor(resolved) };
}

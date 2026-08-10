CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference TEXT NOT NULL,
  month TEXT,
  day TEXT,
  scan_date DATE,
  source_path TEXT NOT NULL UNIQUE,
  document_type TEXT,
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  page_count INT NOT NULL DEFAULT 1,
  ocr_text TEXT,
  extracted JSONB,
  confidence NUMERIC,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.document_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  file_path TEXT NOT NULL,
  is_main BOOLEAN NOT NULL DEFAULT false,
  ocr_text TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number)
);

CREATE TABLE public.app_settings (
  id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  vllm_url TEXT NOT NULL DEFAULT 'http://192.168.101.33:8000/v1',
  vllm_model TEXT NOT NULL DEFAULT '',
  scanner_dir TEXT NOT NULL DEFAULT 'D:\Scanner',
  ocr_prompt TEXT NOT NULL DEFAULT 'You are a document OCR system. Transcribe every visible text of this scanned page exactly, preserving reading order and line breaks. Do not add commentary.',
  extraction_fields JSONB NOT NULL DEFAULT '["reference","document_date","name","address","amount","document_type"]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_status ON public.documents(status);
CREATE INDEX idx_documents_scan_date ON public.documents(scan_date);
CREATE INDEX idx_pages_document ON public.document_pages(document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_pages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.documents TO service_role;
GRANT ALL ON public.document_pages TO service_role;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open access to documents" ON public.documents FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Open access to pages" ON public.document_pages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Open access to settings" ON public.app_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER documents_touch BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER settings_touch BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.app_settings (id) VALUES ('default');
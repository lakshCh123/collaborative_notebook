-- Make subtitles default to an object
ALTER TABLE public.documents
ALTER COLUMN subtitles SET DEFAULT '{}'::jsonb;

-- Device IDs are arbitrary strings, not UUIDs
ALTER TABLE public.documents
ALTER COLUMN device_id TYPE text
USING device_id::text;

ALTER TABLE public.sync_requests
ALTER COLUMN device_id TYPE text
USING device_id::text;

ALTER TABLE public.document_versions
ALTER COLUMN device_id TYPE text
USING device_id::text;

-- Document titles do not need to be globally unique
ALTER TABLE public.documents
DROP CONSTRAINT IF EXISTS documents_title_key;
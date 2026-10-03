ALTER TABLE public.documents
ALTER COLUMN device_id TYPE text
USING device_id::text;

ALTER TABLE public.sync_requests
ALTER COLUMN device_id TYPE text
USING device_id::text;

ALTER TABLE public.document_versions
ALTER COLUMN device_id TYPE text
USING device_id::text;
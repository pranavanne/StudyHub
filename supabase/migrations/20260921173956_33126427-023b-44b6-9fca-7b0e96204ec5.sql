CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

ALTER EXTENSION vector SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(3072),
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.document_id,
    c.content,
    1 - (c.embedding::extensions.halfvec(3072) <=> query_embedding::extensions.halfvec(3072)) AS similarity
  FROM public.document_chunks c
  WHERE c.user_id = auth.uid()
  ORDER BY c.embedding::extensions.halfvec(3072) <=> query_embedding::extensions.halfvec(3072)
  LIMIT match_count;
$$;
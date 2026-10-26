ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_session_id_idx ON public.documents (session_id);

CREATE OR REPLACE FUNCTION public.match_session_chunks(
  query_embedding extensions.vector,
  doc_ids uuid[],
  match_count integer DEFAULT 6
)
RETURNS TABLE(id uuid, document_id uuid, content text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    c.id,
    c.document_id,
    c.content,
    1 - (c.embedding::extensions.halfvec(3072) <=> query_embedding::extensions.halfvec(3072)) AS similarity
  FROM public.document_chunks c
  WHERE c.user_id = auth.uid()
    AND c.document_id = ANY(doc_ids)
  ORDER BY c.embedding::extensions.halfvec(3072) <=> query_embedding::extensions.halfvec(3072)
  LIMIT match_count;
$function$;

GRANT EXECUTE ON FUNCTION public.match_session_chunks(extensions.vector, uuid[], integer) TO authenticated;
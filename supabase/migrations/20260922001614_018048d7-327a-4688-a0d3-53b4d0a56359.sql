CREATE TABLE IF NOT EXISTS public.chat_session_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (session_id, document_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_session_documents TO authenticated;
GRANT ALL ON public.chat_session_documents TO service_role;

ALTER TABLE public.chat_session_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own chat session documents"
  ON public.chat_session_documents
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS chat_session_documents_session_idx ON public.chat_session_documents (session_id);
CREATE INDEX IF NOT EXISTS chat_session_documents_document_idx ON public.chat_session_documents (document_id);

INSERT INTO public.chat_session_documents (user_id, session_id, document_id)
SELECT d.user_id, d.session_id, d.id
FROM public.documents d
WHERE d.session_id IS NOT NULL
ON CONFLICT (session_id, document_id) DO NOTHING;
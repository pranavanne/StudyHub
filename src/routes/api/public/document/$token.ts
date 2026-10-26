import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams a study file through the app's own domain. The token is a short-lived
 * signed claim minted for the signed-in owner, so no session cookie is needed
 * and privacy shields never see a third-party storage request.
 */
export const Route = createFileRoute("/api/public/document/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { verifyDocumentViewToken } = await import("@/lib/document-token.server");
        const claims = await verifyDocumentViewToken(params.token);
        if (!claims) return new Response("Link expired", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: doc, error } = await supabaseAdmin
          .from("documents")
          .select("filename, file_url, user_id")
          .eq("id", claims.documentId)
          .maybeSingle();
        if (error || !doc || doc.user_id !== claims.userId) {
          return new Response("Not found", { status: 404 });
        }

        const { data: file, error: downloadError } = await supabaseAdmin.storage
          .from("materials")
          .download(doc.file_url);
        if (downloadError || !file) return new Response("Not found", { status: 404 });

        const safeName = doc.filename.replace(/["\\\r\n]/g, "");
        return new Response(file.stream(), {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${safeName}"`,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});

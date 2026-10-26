/**
 * Short-lived signed tokens that let the browser stream a stored file through
 * our own domain instead of hitting the storage host directly (which privacy
 * shields in browsers like Opera GX and Brave often block).
 */

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
}

async function hmac(payload: string) {
  const secret = process.env["DOCUMENT_VIEW_SECRET"];
  if (!secret) throw new Error("DOCUMENT_VIEW_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type DocumentViewClaims = { documentId: string; userId: string };

export async function createDocumentViewToken(
  claims: DocumentViewClaims,
  ttlSeconds = 60 * 60,
): Promise<string> {
  const payload = base64UrlEncode(
    JSON.stringify({
      d: claims.documentId,
      u: claims.userId,
      e: Math.floor(Date.now() / 1000) + ttlSeconds,
    }),
  );
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyDocumentViewToken(token: string): Promise<DocumentViewClaims | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = await hmac(payload);
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { d: string; u: string; e: number };
    if (!parsed.d || !parsed.u || typeof parsed.e !== "number") return null;
    if (parsed.e < Math.floor(Date.now() / 1000)) return null;
    return { documentId: parsed.d, userId: parsed.u };
  } catch {
    return null;
  }
}

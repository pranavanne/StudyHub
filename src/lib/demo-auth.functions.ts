import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

// Intentionally public: only grants the dedicated, shared demo account's session.
// Credentials remain server-only; this never provisions users or bypasses RLS.
export const signInRecruiterDemo = createServerFn({ method: "POST" }).handler(async () => {
  setResponseHeader("Cache-Control", "no-store");
  const { authenticateDemo } = await import("./demo-auth.server");
  return authenticateDemo({
    url: process.env["SUPABASE_URL"],
    key: process.env["SUPABASE_PUBLISHABLE_KEY"],
    email: process.env["DEMO_LOGIN_EMAIL"],
    password: process.env["DEMO_LOGIN_PASSWORD"],
  });
});

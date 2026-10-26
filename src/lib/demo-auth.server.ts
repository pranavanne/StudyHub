import { z } from "zod";

const sessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

export async function authenticateDemo(
  config: {
    url?: string | undefined;
    key?: string | undefined;
    email?: string | undefined;
    password?: string | undefined;
  },
  request: typeof fetch = fetch,
) {
  if (!config.url || !config.key || !config.email || !config.password) {
    throw new Error("Recruiter demo login hasn't been configured yet. Please use email sign-in.");
  }
  try {
    const response = await request(
      `${config.url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: config.key, "Content-Type": "application/json" },
        body: JSON.stringify({ email: config.email, password: config.password }),
      },
    );
    if (!response.ok) throw new Error("Demo sign-in failed");
    return sessionSchema.parse(await response.json());
  } catch {
    throw new Error(
      "Recruiter demo login is unavailable. Please use email sign-in or try again later.",
    );
  }
}

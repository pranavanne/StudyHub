import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { authenticateDemo } from "./demo-auth.server";

describe("dedicated recruiter demo login", () => {
  const config = {
    url: "https://example.invalid",
    key: "test-key",
    email: "demo@example.invalid",
    password: "test-only-password",
  };

  test("signs into only the configured shared account and returns session tokens, not credentials", async () => {
    const request = (async (input, init) => {
      assert.equal(input, "https://example.invalid/auth/v1/token?grant_type=password");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        email: config.email,
        password: config.password,
      });
      return Response.json({
        access_token: "test-access",
        refresh_token: "test-refresh",
        user: { email: config.email },
      });
    }) as typeof fetch;
    assert.deepEqual(await authenticateDemo(config, request), {
      access_token: "test-access",
      refresh_token: "test-refresh",
    });
  });

  test("missing demo configuration cannot silently use a personal account", async () => {
    let called = false;
    const request = (async () => {
      called = true;
      return Response.json({});
    }) as typeof fetch;
    await assert.rejects(
      authenticateDemo({ url: config.url, key: config.key }, request),
      /hasn't been configured/,
    );
    assert.equal(called, false);
  });

  test("provider errors do not reveal account details", async () => {
    const request = (async () =>
      Response.json({ error: "internal provider details" }, { status: 400 })) as typeof fetch;
    await assert.rejects(
      authenticateDemo(config, request),
      /Recruiter demo login is unavailable\./,
    );
  });
});

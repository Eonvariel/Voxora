import { describe, expect, it, vi } from "vitest";
import { createRequestUrlHttpClient } from "../src/obsidian-http-client";

describe("createRequestUrlHttpClient", () => {
  it("posts JSON through Obsidian requestUrl without browser fetch", async () => {
    const requestUrl = vi.fn(async () => ({
      status: 200,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      json: { ok: true },
      text: "{\"ok\":true}"
    }));
    const client = createRequestUrlHttpClient(requestUrl);

    const response = await client("https://example.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer key"
      },
      body: "{\"model\":\"qwen\"}"
    });

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://example.com/v1/chat/completions",
      method: "POST",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer key"
      },
      body: "{\"model\":\"qwen\"}",
      throw: false
    });
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

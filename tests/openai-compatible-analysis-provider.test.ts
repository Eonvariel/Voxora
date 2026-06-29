import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleAnalysisProvider } from "../src/providers/openai-compatible-analysis-provider";

describe("OpenAICompatibleAnalysisProvider", () => {
  const validSettings = {
    baseUrl: "https://example.com/v1",
    apiKey: "key",
    model: "model"
  };

  it("posts a fixed meeting analysis prompt to chat completions", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "确认第一版范围。",
                decisions: ["只支持桌面端"],
                actionItems: ["实现状态机"],
                followUpQuestions: ["确认阿里百炼账号"]
              })
            }
          }
        ]
      })
    })) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAnalysisProvider(
      {
        baseUrl: "https://example.com/v1",
        apiKey: "key",
        model: "model"
      },
      fetchMock
    );

    const result = await provider.analyze({
      title: "会议",
      transcript: "[00:00:01] 我们只做桌面端。",
      highlights: []
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer key"
        })
      })
    );
    expect(result.decisions).toEqual(["只支持桌面端"]);
  });

  it("calls the default global fetch with the global binding", async () => {
    const fetchMock = vi.fn(async function (this: unknown) {
      expect(this).toBe(globalThis);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "ok",
                  decisions: [],
                  actionItems: [],
                  followUpQuestions: []
                })
              }
            }
          ]
        })
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    try {
      const provider = new OpenAICompatibleAnalysisProvider(validSettings);

      await provider.analyze({
        title: "连接测试",
        transcript: "内容",
        highlights: []
      });

      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws a readable error when the response is not JSON analysis", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "plain text" } }]
      })
    })) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAnalysisProvider(
      { baseUrl: "https://example.com/v1", apiKey: "key", model: "model" },
      fetchMock
    );

    await expect(
      provider.analyze({ title: "会议", transcript: "内容", highlights: [] })
    ).rejects.toThrow("AI analysis response was not valid JSON");
  });

  it.each(["", "   "])(
    "rejects without calling fetch when the API key is %j",
    async (apiKey) => {
      const fetchMock = vi.fn() as unknown as typeof fetch;
      const provider = new OpenAICompatibleAnalysisProvider(
        { ...validSettings, apiKey },
        fetchMock
      );

      await expect(
        provider.analyze({ title: "会议", transcript: "内容", highlights: [] })
      ).rejects.toThrow("API key");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["", "   "])(
    "rejects without calling fetch when the model is %j",
    async (model) => {
      const fetchMock = vi.fn() as unknown as typeof fetch;
      const provider = new OpenAICompatibleAnalysisProvider(
        { ...validSettings, model },
        fetchMock
      );

      await expect(
        provider.analyze({ title: "会议", transcript: "内容", highlights: [] })
      ).rejects.toThrow("model");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("throws a readable error when the HTTP response is not ok", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429
    })) as unknown as typeof fetch;
    const provider = new OpenAICompatibleAnalysisProvider(
      validSettings,
      fetchMock
    );

    await expect(
      provider.analyze({ title: "会议", transcript: "内容", highlights: [] })
    ).rejects.toThrow("AI analysis request failed with HTTP 429");
  });

  it.each([
    [{ choices: [] }, "empty choices"],
    [{ choices: [{ message: { content: "" } }] }, "empty message content"]
  ])(
    "throws a readable error when the response has no content: %s",
    async (payload) => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => payload
      })) as unknown as typeof fetch;
      const provider = new OpenAICompatibleAnalysisProvider(
        validSettings,
        fetchMock
      );

      await expect(
        provider.analyze({ title: "会议", transcript: "内容", highlights: [] })
      ).rejects.toThrow(
        "AI analysis response did not include message content"
      );
    }
  );

  it("keeps only strings from array fields in the JSON content", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "摘要",
                decisions: ["保留决定", 1, null, { text: "drop" }],
                actionItems: [false, "保留行动", ["drop"]],
                followUpQuestions: ["保留问题", undefined, 3]
              })
            }
          }
        ]
      })
    })) as unknown as typeof fetch;
    const provider = new OpenAICompatibleAnalysisProvider(
      validSettings,
      fetchMock
    );

    const result = await provider.analyze({
      title: "会议",
      transcript: "内容",
      highlights: []
    });

    expect(result).toEqual({
      summary: "摘要",
      decisions: ["保留决定"],
      actionItems: ["保留行动"],
      followUpQuestions: ["保留问题"]
    });
  });

  it("posts to chat completions when the base URL has a trailing slash", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "",
                decisions: [],
                actionItems: [],
                followUpQuestions: []
              })
            }
          }
        ]
      })
    })) as unknown as typeof fetch;
    const provider = new OpenAICompatibleAnalysisProvider(
      { ...validSettings, baseUrl: "https://example.com/v1/" },
      fetchMock
    );

    await provider.analyze({ title: "会议", transcript: "内容", highlights: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/v1/chat/completions",
      expect.any(Object)
    );
  });

  it("throws a readable error when response JSON parsing fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      }
    })) as unknown as typeof fetch;
    const provider = new OpenAICompatibleAnalysisProvider(
      validSettings,
      fetchMock
    );

    await expect(
      provider.analyze({ title: "会议", transcript: "内容", highlights: [] })
    ).rejects.toThrow("AI analysis response body was not valid JSON");
  });

  it.each([null, "text", 42, true])(
    "throws a readable error when response JSON is not an object: %j",
    async (payload) => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => payload
      })) as unknown as typeof fetch;
      const provider = new OpenAICompatibleAnalysisProvider(
        validSettings,
        fetchMock
      );

      await expect(
        provider.analyze({ title: "会议", transcript: "内容", highlights: [] })
      ).rejects.toThrow("AI analysis response body was not an object");
    }
  );
});

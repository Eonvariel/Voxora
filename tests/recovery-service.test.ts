import { describe, expect, it } from "vitest";
import { MeetingFrontmatter } from "../src/domain";
import { buildInterruptedFrontmatter, shouldOfferRecovery } from "../src/recovery-service";

describe("recovery service helpers", () => {
  it("detects sessions that need recovery", () => {
    expect(shouldOfferRecovery({ status: "interrupted", audioPath: "a.webm" })).toBe(true);
    expect(shouldOfferRecovery({ status: "completed", audioPath: "a.webm" })).toBe(false);
    expect(shouldOfferRecovery({ status: "interrupted" })).toBe(false);
    expect(shouldOfferRecovery({ status: "interrupted", audioPath: "   " })).toBe(false);
  });

  it("marks frontmatter as interrupted", () => {
    const input: MeetingFrontmatter = {
      title: "会议",
      startedAt: "2026-06-28T15:30:00+08:00",
      status: "recording",
      audioPath: "Attachments/meeting.webm",
      transcriptionProvider: "alibaba-bailian",
      analysisProvider: "openai-compatible",
      analysisModel: "qwen-plus"
    };

    const frontmatter = buildInterruptedFrontmatter(input, 600);

    expect(frontmatter.status).toBe("interrupted");
    expect(frontmatter.durationSeconds).toBe(600);
    expect(frontmatter.title).toBe("会议");
    expect(frontmatter.startedAt).toBe("2026-06-28T15:30:00+08:00");
    expect(frontmatter.audioPath).toBe("Attachments/meeting.webm");
    expect(frontmatter.transcriptionProvider).toBe("alibaba-bailian");
    expect(frontmatter.analysisProvider).toBe("openai-compatible");
    expect(frontmatter.analysisModel).toBe("qwen-plus");
    expect(input.status).toBe("recording");
    expect(input.durationSeconds).toBeUndefined();
  });
});

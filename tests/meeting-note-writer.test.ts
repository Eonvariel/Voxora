import { describe, expect, it } from "vitest";
import {
  appendTranscriptSegment,
  buildAnalysisErrorMarkdown,
  buildAnalysisMarkdown,
  buildAnalysisPendingMarkdown,
  buildInitialMeetingMinutes,
  buildInitialTranscriptNote,
  insertHighlightMark,
  replaceAnalysisBlock,
  updateMeetingFrontmatter
} from "../src/meeting-note-writer";

describe("meeting note writer", () => {
  const frontmatter = {
    title: "会议记录 2026-06-28 15-30",
    startedAt: "2026-06-28T15:30:00+08:00",
    status: "recording" as const,
    audioPath: "Attachments/Meetings/meeting.webm",
    transcriptionProvider: "alibaba-bailian" as const,
    analysisProvider: "openai-compatible" as const,
    analysisModel: "qwen-plus"
  };

  it("builds a transcript note without the meeting minutes content", () => {
    const note = buildInitialTranscriptNote(frontmatter);
    expect(note).toContain("<!-- voxora-transcript:start -->");
    expect(note).toContain("<!-- voxora-transcript:end -->");
    expect(note).toContain("## 会议信息");
    expect(note).toContain("## 重点标记");
    expect(note).toContain("## 完整转写");
    expect(note).not.toContain("<!-- voxora-analysis:start -->");
    expect(note).not.toContain("## AI 分析");
    expect(note.startsWith("---")).toBe(false);
    expect(note).not.toContain("audioPath:");
  });

  it("builds a meeting minutes note without transcript boundaries", () => {
    const note = buildInitialMeetingMinutes(frontmatter);
    expect(note).toContain("<!-- voxora-analysis:start -->");
    expect(note).toContain("<!-- voxora-analysis:end -->");
    expect(note).toContain("## AI 分析");
    expect(note).toContain("AI 会议纪要等待生成");
    expect(note).toContain("voxora-ai-pending");
    expect(note).not.toContain("<!-- voxora-transcript:start -->");
    expect(note).not.toContain("## 完整转写");
    expect(note.startsWith("---")).toBe(false);
  });

  it("appends final transcript before the transcript end marker", () => {
    const note = buildInitialTranscriptNote(frontmatter);
    const updated = appendTranscriptSegment(note, {
      id: "seg-1",
      startSeconds: 754,
      text: "我们确认第一版只做桌面端。",
      final: true
    });

    expect(updated).toContain("[00:12:34] 我们确认第一版只做桌面端。");
    expect(updated.indexOf("[00:12:34]")).toBeLessThan(updated.indexOf("<!-- voxora-transcript:end -->"));
  });

  it("does not append non-final transcript segments", () => {
    const note = buildInitialTranscriptNote(frontmatter);
    const updated = appendTranscriptSegment(note, {
      id: "seg-1",
      startSeconds: 754,
      text: "这段还在变化。",
      final: false
    });

    expect(updated).toBe(note);
  });

  it("throws when appending transcript without the transcript marker", () => {
    expect(() =>
      appendTranscriptSegment("plain", {
        id: "seg-1",
        startSeconds: 754,
        text: "这段不能悄悄丢失。",
        final: true
      })
    ).toThrow(/Cannot find marker/);
  });

  it("inserts highlight marks into the highlight section", () => {
    const note = buildInitialTranscriptNote(frontmatter);
    const updated = insertHighlightMark(note, {
      id: "mark-1",
      seconds: 90,
      label: "重点标记"
    });

    expect(updated).toContain("- [00:01:30] 重点标记");
  });

  it("replaces only the analysis block", () => {
    const note = buildInitialMeetingMinutes(frontmatter);
    const analysis = buildAnalysisMarkdown({
      summary: "会议确认第一版范围。",
      decisions: ["只支持桌面端"],
      actionItems: ["实现录音状态机"],
      followUpQuestions: ["阿里百炼账号配置由谁提供"]
    });
    const updated = replaceAnalysisBlock(note, analysis);

    expect(updated).toContain("### 摘要");
    expect(updated).toContain("### 关键决策");
    expect(updated).toContain("### 行动项");
    expect(updated).toContain("### 待跟进问题");
    expect(updated).toContain("会议确认第一版范围。");
    expect(updated).not.toContain("## 完整转写");
  });

  it("throws when replacing analysis without section markers", () => {
    expect(() => replaceAnalysisBlock("plain", "analysis")).toThrow(/Cannot find section markers/);
  });

  it("builds an AI generation pending state", () => {
    const pending = buildAnalysisPendingMarkdown("AI 会议纪要生成中，请稍候。");

    expect(pending).toContain("voxora-ai-pending");
    expect(pending).toContain("AI 会议纪要生成中，请稍候。");
  });

  it("builds an AI generation failure state", () => {
    const failed = buildAnalysisErrorMarkdown("模型调用失败");

    expect(failed).toContain("voxora-ai-error");
    expect(failed).toContain("模型调用失败");
  });

  it("updates visible meeting info without adding frontmatter", () => {
    const note = buildInitialTranscriptNote(frontmatter);
    const updated = updateMeetingFrontmatter(note, {
      ...frontmatter,
      status: "completed",
      durationSeconds: 1800,
      endedAt: "2026-06-28T16:00:00+08:00"
    });

    expect(updated.startsWith("---")).toBe(false);
    expect(updated).toContain("- 状态：已完成");
    expect(updated).toContain("- 时长：00:30:00");
    expect(updated).toContain("## 完整转写");
    expect(updated).not.toContain("durationSeconds:");
  });
});

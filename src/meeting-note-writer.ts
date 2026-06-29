import type {
  AnalysisResult,
  HighlightMark,
  MeetingFrontmatter,
  RecordingStatus,
  TranscriptSegment
} from "./domain";
import { formatClockTime, formatTimestamp } from "./time";

export const ANALYSIS_START = "<!-- voxora-analysis:start -->";
export const ANALYSIS_END = "<!-- voxora-analysis:end -->";
export const TRANSCRIPT_START = "<!-- voxora-transcript:start -->";
export const TRANSCRIPT_END = "<!-- voxora-transcript:end -->";

const HIGHLIGHTS_START = "<!-- voxora-highlights:start -->";
const HIGHLIGHTS_END = "<!-- voxora-highlights:end -->";

export function buildInitialTranscriptNote(frontmatter: MeetingFrontmatter): string {
  const startedAt = formatClockTime(new Date(frontmatter.startedAt));

  return [
    `# ${frontmatter.title} 转写`,
    "",
    "## 会议信息",
    "",
    `- 录音：${formatAudioLink(frontmatter.audioPath)}`,
    `- 开始时间：${startedAt}`,
    `- 状态：${formatStatus(frontmatter.status)}`,
    "",
    "## 重点标记",
    "",
    HIGHLIGHTS_START,
    HIGHLIGHTS_END,
    "",
    TRANSCRIPT_START,
    "## 完整转写",
    "",
    TRANSCRIPT_END,
    ""
  ].join("\n");
}

export function buildInitialMeetingMinutes(frontmatter: MeetingFrontmatter): string {
  const startedAt = formatClockTime(new Date(frontmatter.startedAt));

  return [
    `# ${frontmatter.title} 会议纪要`,
    "",
    "## 会议信息",
    "",
    `- 录音：${formatAudioLink(frontmatter.audioPath)}`,
    `- 开始时间：${startedAt}`,
    `- 状态：${formatStatus(frontmatter.status)}`,
    "",
    ANALYSIS_START,
    "## AI 分析",
    "",
    buildAnalysisPendingMarkdown("AI 会议纪要等待生成，录音结束后会自动开始。"),
    ANALYSIS_END,
    ""
  ].join("\n");
}

export const buildInitialMeetingNote = buildInitialTranscriptNote;

export function appendTranscriptSegment(markdown: string, segment: TranscriptSegment): string {
  if (!segment.final) {
    return markdown;
  }

  const line = `[${formatTimestamp(segment.startSeconds)}] ${segment.text.trim()}`;
  return insertBeforeMarker(markdown, TRANSCRIPT_END, line);
}

export function insertHighlightMark(markdown: string, mark: HighlightMark): string {
  const line = `- [${formatTimestamp(mark.seconds)}] ${mark.label.trim()}`;
  return insertBeforeMarker(markdown, HIGHLIGHTS_END, line);
}

export function buildAnalysisMarkdown(result: AnalysisResult): string {
  return [
    "### 摘要",
    "",
    result.summary,
    "",
    "### 关键决策",
    "",
    formatList(result.decisions),
    "",
    "### 行动项",
    "",
    formatList(result.actionItems),
    "",
    "### 待跟进问题",
    "",
    formatList(result.followUpQuestions)
  ].join("\n");
}

export function buildAnalysisPendingMarkdown(message: string): string {
  return [
    '<div class="voxora-ai-pending">',
    '<span class="voxora-ai-spinner"></span>',
    `<span>${message}</span>`,
    "</div>"
  ].join("\n");
}

export function buildAnalysisErrorMarkdown(message: string): string {
  return [
    '<div class="voxora-ai-error">',
    "<strong>AI 会议纪要生成失败</strong>",
    `<span>${message}</span>`,
    "</div>"
  ].join("\n");
}

export function replaceAnalysisBlock(markdown: string, analysisMarkdown: string): string {
  return replaceBetweenMarkers(markdown, ANALYSIS_START, ANALYSIS_END, analysisMarkdown.trim());
}

export function updateMeetingFrontmatter(markdown: string, frontmatter: MeetingFrontmatter): string {
  let updated = stripFrontmatter(markdown);
  updated = replaceInfoLine(updated, "状态", formatStatus(frontmatter.status));

  if (frontmatter.endedAt) {
    updated = upsertInfoLine(
      updated,
      "结束时间",
      formatClockTime(new Date(frontmatter.endedAt)),
      "状态"
    );
  }

  if (frontmatter.durationSeconds !== undefined) {
    updated = upsertInfoLine(
      updated,
      "时长",
      formatTimestamp(frontmatter.durationSeconds),
      frontmatter.endedAt ? "结束时间" : "状态"
    );
  }

  return updated;
}

function formatAudioLink(audioPath: string | undefined): string {
  if (audioPath === undefined || audioPath.trim() === "") {
    return "未保存";
  }

  const fileName = audioPath.split(/[\\/]/).at(-1);
  return `[[${fileName ?? audioPath}]]`;
}

function insertBeforeMarker(markdown: string, marker: string, line: string): string {
  const markerIndex = markdown.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Cannot find marker ${marker}`);
  }

  const before = markdown.slice(0, markerIndex).replace(/\s*$/, "\n");
  const after = markdown.slice(markerIndex);
  return `${before}${line}\n${after}`;
}

function replaceBetweenMarkers(markdown: string, startMarker: string, endMarker: string, content: string): string {
  const startIndex = markdown.indexOf(startMarker);
  const endIndex = markdown.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Cannot find section markers ${startMarker} ${endMarker}`);
  }

  const contentStart = startIndex + startMarker.length;
  return `${markdown.slice(0, contentStart)}\n${content}\n${markdown.slice(endIndex)}`;
}

function stripFrontmatter(markdown: string): string {
  const endOfFrontmatter = markdown.indexOf("\n---\n");
  if (!markdown.startsWith("---\n") || endOfFrontmatter === -1) {
    return markdown;
  }

  return markdown.slice(endOfFrontmatter + "\n---\n".length).replace(/^\n+/, "");
}

function replaceInfoLine(markdown: string, label: string, value: string): string {
  const pattern = new RegExp(`^- ${escapeRegExp(label)}：.*$`, "m");
  if (pattern.test(markdown)) {
    return markdown.replace(pattern, `- ${label}：${value}`);
  }

  return upsertInfoLine(markdown, label, value, "开始时间");
}

function upsertInfoLine(
  markdown: string,
  label: string,
  value: string,
  afterLabel: string
): string {
  const existing = new RegExp(`^- ${escapeRegExp(label)}：.*$`, "m");
  if (existing.test(markdown)) {
    return markdown.replace(existing, `- ${label}：${value}`);
  }

  const after = new RegExp(`(^- ${escapeRegExp(afterLabel)}：.*$)`, "m");
  if (after.test(markdown)) {
    return markdown.replace(after, `$1\n- ${label}：${value}`);
  }

  return `${markdown.replace(/\s*$/, "")}\n- ${label}：${value}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatStatus(status: RecordingStatus): string {
  const labels: Record<RecordingStatus, string> = {
    idle: "待机",
    starting: "启动中",
    recording: "录音中",
    paused: "已暂停",
    stopping: "停止中",
    analyzing: "AI 纪要生成中",
    completed: "已完成",
    interrupted: "已中断",
    failed: "失败"
  };

  return labels[status];
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- 无";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

# Obsidian Meeting Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-only Obsidian plugin that records microphone audio, streams confirmed transcription segments into a Markdown meeting note, saves the recording in the vault, and generates a fixed AI meeting summary after recording stops.

**Architecture:** The plugin is a TypeScript Obsidian plugin with isolated modules for settings, recording state, audio capture, transcription provider, note writing, AI analysis, recovery, and UI. State-machine and Markdown behavior are covered by unit tests with mock providers before the Obsidian UI is wired in. External providers are kept behind narrow interfaces so the first release can use Alibaba Bailian for speech and OpenAI-compatible chat completions for analysis without leaking provider details into the rest of the app.

**Tech Stack:** Obsidian plugin API, TypeScript, esbuild, Vitest, YAML, browser MediaRecorder/AudioContext APIs, `ws` for desktop WebSocket requests with headers, Alibaba Bailian Paraformer real-time speech recognition, OpenAI-compatible `/chat/completions`.

---

## Reference Docs

- Obsidian plugin structure: `https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin`
- Obsidian sample plugin conventions: `https://github.com/obsidianmd/obsidian-sample-plugin`
- Alibaba Bailian Paraformer real-time speech recognition: `https://help.aliyun.com/zh/model-studio/paraformer-real-time-speech-recognition-api`
- Alibaba Bailian WebSocket service pattern: `https://help.aliyun.com/zh/model-studio/websocket-for-paraformer-real-time-service`

## File Structure

- Create `package.json`: npm scripts and dependencies.
- Create `tsconfig.json`: strict TypeScript config for plugin source and tests.
- Create `esbuild.config.mjs`: bundle `src/main.ts` into `main.js` for Obsidian.
- Create `vitest.config.ts`: unit test config.
- Create `manifest.json`: desktop-only Obsidian plugin manifest.
- Create `versions.json`: Obsidian plugin version compatibility.
- Create `styles.css`: minimal sidebar styles.
- Create `.gitignore`: ignores build output and dependency folders.
- Create `src/domain.ts`: shared domain types and provider interfaces.
- Create `src/settings.ts`: default settings, validation, and persisted shape.
- Create `src/time.ts`: timestamp and filename helpers.
- Create `src/meeting-note-writer.ts`: Markdown/frontmatter construction and section replacement.
- Create `src/recording-controller.ts`: recording state machine and orchestration.
- Create `src/providers/openai-compatible-analysis-provider.ts`: AI summary provider.
- Create `src/providers/alibaba-bailian-protocol.ts`: pure Bailian WebSocket message helpers.
- Create `src/providers/alibaba-bailian-transcription-provider.ts`: WebSocket transcription provider.
- Create `src/audio/pcm.ts`: PCM conversion helpers.
- Create `src/audio/audio-capture.ts`: microphone capture, PCM streaming, and WebM recording.
- Create `src/recovery-service.ts`: interrupted-meeting detection and status updates.
- Create `src/settings-tab.ts`: Obsidian settings tab.
- Create `src/recorder-view.ts`: sidebar recorder view.
- Create `src/main.ts`: plugin lifecycle, commands, ribbon, and dependency wiring.
- Create `tests/*.test.ts`: unit tests for pure behavior and provider boundaries.

## Task 1: Scaffold the Obsidian Plugin Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `vitest.config.ts`
- Create: `manifest.json`
- Create: `versions.json`
- Create: `styles.css`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "voxora",
  "version": "0.1.0",
  "description": "Desktop Obsidian meeting recorder with live transcription and AI analysis.",
  "main": "main.js",
  "scripts": {
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -noEmit -skipLibCheck"
  },
  "keywords": [
    "obsidian",
    "meeting",
    "transcription",
    "recorder"
  ],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/ws": "^8.5.10",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.23.0",
    "obsidian": "^1.6.5",
    "tslib": "^2.6.3",
    "typescript": "^5.5.3",
    "vitest": "^2.0.5"
  },
  "dependencies": {
    "uuid": "^10.0.0",
    "ws": "^8.17.1",
    "yaml": "^2.4.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2020",
    "allowJs": false,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitReturns": true,
    "strict": true,
    "lib": [
      "DOM",
      "ES2020"
    ],
    "types": [
      "node",
      "vitest/globals"
    ]
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts",
    "vitest.config.ts"
  ]
}
```

- [ ] **Step 3: Create `esbuild.config.mjs`**

```js
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner =
  "/* Voxora: desktop-only Obsidian plugin for meeting recording. */";
const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: {
    js: banner
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true
  }
});
```

- [ ] **Step 5: Create plugin metadata and styles**

Create `manifest.json`:

```json
{
  "id": "voxora",
  "name": "Voxora",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Record meetings, transcribe them, and generate AI meeting notes in Obsidian.",
  "author": "",
  "authorUrl": "",
  "isDesktopOnly": true
}
```

Create `versions.json`:

```json
{
  "0.1.0": "1.5.0"
}
```

Create `styles.css`:

```css
.voxora-recorder-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.voxora-recorder-view .setting-item {
  padding: 0;
}

.voxora-status {
  font-weight: 600;
}

.voxora-live-text {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  min-height: 96px;
  padding: 8px;
  overflow: auto;
  white-space: pre-wrap;
}

.voxora-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

Create `.gitignore`:

```gitignore
node_modules/
main.js
*.map
.DS_Store
coverage/
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
npm install
```

Expected: npm creates `package-lock.json` and exits with code 0.

- [ ] **Step 7: Add a temporary entry file so the scaffold builds**

Create `src/main.ts`:

```ts
import { Plugin } from "obsidian";

export default class VoxoraPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addRibbonIcon("mic", "Open Voxora", () => undefined);
  }
}
```

- [ ] **Step 8: Verify the scaffold**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit with code 0 and `main.js` is created.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json esbuild.config.mjs vitest.config.ts manifest.json versions.json styles.css .gitignore src/main.ts
git commit -m "chore: scaffold obsidian plugin"
```

## Task 2: Add Domain Types, Settings, and Time Helpers

**Files:**
- Create: `src/domain.ts`
- Create: `src/settings.ts`
- Create: `src/time.ts`
- Create: `tests/settings.test.ts`
- Create: `tests/time.test.ts`

- [ ] **Step 1: Write failing tests for settings and time helpers**

Create `tests/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings";

describe("settings", () => {
  it("keeps stable defaults for first launch", () => {
    expect(DEFAULT_SETTINGS.notesFolder).toBe("Meetings");
    expect(DEFAULT_SETTINGS.recordingsFolder).toBe("Attachments/Meetings");
    expect(DEFAULT_SETTINGS.saveAudio).toBe(true);
    expect(DEFAULT_SETTINGS.autoAnalyze).toBe(true);
  });

  it("normalizes missing persisted settings", () => {
    const settings = normalizeSettings({
      notesFolder: "Work/Meetings",
      analysis: { baseUrl: "https://example.com/v1" }
    });

    expect(settings.notesFolder).toBe("Work/Meetings");
    expect(settings.recordingsFolder).toBe("Attachments/Meetings");
    expect(settings.analysis.baseUrl).toBe("https://example.com/v1");
    expect(settings.analysis.model).toBe("");
  });
});
```

Create `tests/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatClockTime,
  formatDuration,
  formatTimestamp,
  makeDefaultMeetingTitle,
  makeSafeFilename
} from "../src/time";

describe("time helpers", () => {
  const date = new Date("2026-06-28T07:30:05.000Z");

  it("formats elapsed seconds as transcript timestamps", () => {
    expect(formatTimestamp(5)).toBe("00:00:05");
    expect(formatTimestamp(754)).toBe("00:12:34");
    expect(formatTimestamp(3661)).toBe("01:01:01");
  });

  it("formats duration seconds for frontmatter", () => {
    expect(formatDuration(1800)).toBe("30:00");
  });

  it("creates readable titles and safe filenames", () => {
    expect(makeDefaultMeetingTitle(date)).toBe("会议记录 2026-06-28 07-30");
    expect(makeSafeFilename("设计/评审: 第 1 次")).toBe("设计-评审-第-1-次");
  });

  it("formats clock time with minutes", () => {
    expect(formatClockTime(date)).toBe("2026-06-28 07:30");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/settings.test.ts tests/time.test.ts
```

Expected: FAIL because `src/settings.ts` and `src/time.ts` do not exist.

- [ ] **Step 3: Create `src/domain.ts`**

```ts
export type RecordingStatus =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "analyzing"
  | "completed"
  | "interrupted"
  | "failed";

export interface MeetingFrontmatter {
  title: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  status: RecordingStatus;
  audioPath?: string;
  transcriptionProvider: "alibaba-bailian";
  analysisProvider: "openai-compatible";
  analysisModel: string;
}

export interface TranscriptSegment {
  id: string;
  startSeconds: number;
  text: string;
  final: boolean;
}

export interface HighlightMark {
  id: string;
  seconds: number;
  label: string;
}

export interface AnalysisResult {
  summary: string;
  decisions: string[];
  actionItems: string[];
  followUpQuestions: string[];
}

export interface MeetingSession {
  id: string;
  title: string;
  notePath: string;
  audioPath?: string;
  startedAt: Date;
  status: RecordingStatus;
}

export interface TranscriptionProvider {
  connect(): Promise<void>;
  sendPcmFrame(frame: Int16Array): void;
  finish(): Promise<void>;
  close(): void;
  onTemporaryResult(listener: (text: string) => void): void;
  onFinalSegment(listener: (segment: TranscriptSegment) => void): void;
  onError(listener: (error: Error) => void): void;
}

export interface AnalysisProvider {
  analyze(input: {
    title: string;
    transcript: string;
    highlights: HighlightMark[];
  }): Promise<AnalysisResult>;
}
```

- [ ] **Step 4: Create `src/settings.ts`**

```ts
export interface AlibabaBailianSettings {
  apiKey: string;
  model: string;
  sampleRate: number;
  endpoint: string;
}

export interface OpenAICompatibleSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface VoxoraSettings {
  notesFolder: string;
  recordingsFolder: string;
  defaultInputDeviceId: string;
  saveAudio: boolean;
  autoAnalyze: boolean;
  transcription: AlibabaBailianSettings;
  analysis: OpenAICompatibleSettings;
}

export const DEFAULT_SETTINGS: VoxoraSettings = {
  notesFolder: "Meetings",
  recordingsFolder: "Attachments/Meetings",
  defaultInputDeviceId: "",
  saveAudio: true,
  autoAnalyze: true,
  transcription: {
    apiKey: "",
    model: "paraformer-realtime-v2",
    sampleRate: 16000,
    endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
  },
  analysis: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: ""
  }
};

export function normalizeSettings(input: Partial<VoxoraSettings>): VoxoraSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    transcription: {
      ...DEFAULT_SETTINGS.transcription,
      ...input.transcription
    },
    analysis: {
      ...DEFAULT_SETTINGS.analysis,
      ...input.analysis
    }
  };
}
```

- [ ] **Step 5: Create `src/time.ts`**

```ts
function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${pad(remainingSeconds)}`;
}

export function formatClockTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function makeDefaultMeetingTitle(date: Date): string {
  return `会议记录 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

export function makeSafeFilename(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
```

- [ ] **Step 6: Verify tests pass**

Run:

```bash
npm test -- tests/settings.test.ts tests/time.test.ts
npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 7: Commit**

```bash
git add src/domain.ts src/settings.ts src/time.ts tests/settings.test.ts tests/time.test.ts
git commit -m "feat: add core domain settings and time helpers"
```

## Task 3: Implement Markdown Meeting Note Writer

**Files:**
- Create: `src/meeting-note-writer.ts`
- Create: `tests/meeting-note-writer.test.ts`

- [ ] **Step 1: Write failing note writer tests**

Create `tests/meeting-note-writer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  appendTranscriptSegment,
  buildAnalysisMarkdown,
  buildInitialMeetingNote,
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

  it("builds a note with fixed analysis and transcript boundaries", () => {
    const note = buildInitialMeetingNote(frontmatter);
    expect(note).toContain("<!-- voxora-analysis:start -->");
    expect(note).toContain("<!-- voxora-analysis:end -->");
    expect(note).toContain("<!-- voxora-transcript:start -->");
    expect(note).toContain("<!-- voxora-transcript:end -->");
    expect(note).toContain("audioPath: Attachments/Meetings/meeting.webm");
  });

  it("appends final transcript before the transcript end marker", () => {
    const note = buildInitialMeetingNote(frontmatter);
    const updated = appendTranscriptSegment(note, {
      id: "seg-1",
      startSeconds: 754,
      text: "我们确认第一版只做桌面端。",
      final: true
    });

    expect(updated).toContain("[00:12:34] 我们确认第一版只做桌面端。");
    expect(updated.indexOf("[00:12:34]")).toBeLessThan(updated.indexOf("<!-- voxora-transcript:end -->"));
  });

  it("inserts highlight marks into the highlight section", () => {
    const note = buildInitialMeetingNote(frontmatter);
    const updated = insertHighlightMark(note, {
      id: "mark-1",
      seconds: 90,
      label: "重点标记"
    });

    expect(updated).toContain("- [00:01:30] 重点标记");
  });

  it("replaces only the analysis block", () => {
    const note = appendTranscriptSegment(buildInitialMeetingNote(frontmatter), {
      id: "seg-1",
      startSeconds: 5,
      text: "保留这段转写。",
      final: true
    });

    const analysis = buildAnalysisMarkdown({
      summary: "会议确认第一版范围。",
      decisions: ["只支持桌面端"],
      actionItems: ["实现录音状态机"],
      followUpQuestions: ["阿里百炼账号配置由谁提供"]
    });
    const updated = replaceAnalysisBlock(note, analysis);

    expect(updated).toContain("会议确认第一版范围。");
    expect(updated).toContain("[00:00:05] 保留这段转写。");
  });

  it("updates frontmatter without changing body content", () => {
    const note = buildInitialMeetingNote(frontmatter);
    const updated = updateMeetingFrontmatter(note, {
      ...frontmatter,
      status: "completed",
      durationSeconds: 1800,
      endedAt: "2026-06-28T16:00:00+08:00"
    });

    expect(updated).toContain("status: completed");
    expect(updated).toContain("durationSeconds: 1800");
    expect(updated).toContain("## 完整转写");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/meeting-note-writer.test.ts
```

Expected: FAIL because `src/meeting-note-writer.ts` does not exist.

- [ ] **Step 3: Create `src/meeting-note-writer.ts`**

```ts
import YAML from "yaml";
import {
  AnalysisResult,
  HighlightMark,
  MeetingFrontmatter,
  TranscriptSegment
} from "./domain";
import { formatClockTime, formatTimestamp } from "./time";

export const ANALYSIS_START = "<!-- voxora-analysis:start -->";
export const ANALYSIS_END = "<!-- voxora-analysis:end -->";
export const TRANSCRIPT_START = "<!-- voxora-transcript:start -->";
export const TRANSCRIPT_END = "<!-- voxora-transcript:end -->";

function serializeFrontmatter(frontmatter: MeetingFrontmatter): string {
  return `---\n${YAML.stringify(frontmatter).trim()}\n---`;
}

function replaceBetween(markdown: string, start: string, end: string, replacement: string): string {
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Cannot find section markers ${start} and ${end}`);
  }

  const before = markdown.slice(0, startIndex + start.length);
  const after = markdown.slice(endIndex);
  return `${before}\n${replacement.trim()}\n${after}`;
}

export function buildInitialMeetingNote(frontmatter: MeetingFrontmatter): string {
  const startedAt = new Date(frontmatter.startedAt);
  const audioLine = frontmatter.audioPath ? `- 录音：[[${frontmatter.audioPath.split("/").at(-1)}]]` : "- 录音：未保存";

  return `${serializeFrontmatter(frontmatter)}

# ${frontmatter.title}

${ANALYSIS_START}
## AI 分析

录音结束后自动生成。
${ANALYSIS_END}

## 会议信息

${audioLine}
- 开始时间：${formatClockTime(startedAt)}
- 状态：${frontmatter.status}

## 重点标记

${TRANSCRIPT_START}
## 完整转写

${TRANSCRIPT_END}
`;
}

export function appendTranscriptSegment(markdown: string, segment: TranscriptSegment): string {
  if (!segment.final) {
    return markdown;
  }

  const line = `[${formatTimestamp(segment.startSeconds)}] ${segment.text.trim()}`;
  return markdown.replace(TRANSCRIPT_END, `${line}\n\n${TRANSCRIPT_END}`);
}

export function insertHighlightMark(markdown: string, mark: HighlightMark): string {
  const heading = "## 重点标记";
  const headingIndex = markdown.indexOf(heading);

  if (headingIndex === -1) {
    throw new Error("Cannot find highlight section");
  }

  const insertionPoint = markdown.indexOf("\n\n", headingIndex + heading.length);
  const line = `- [${formatTimestamp(mark.seconds)}] ${mark.label}`;

  if (insertionPoint === -1) {
    return `${markdown.trimEnd()}\n${line}\n`;
  }

  return `${markdown.slice(0, insertionPoint + 2)}${line}\n${markdown.slice(insertionPoint + 2)}`;
}

export function buildAnalysisMarkdown(result: AnalysisResult): string {
  const list = (items: string[]) => items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 无";

  return `## AI 分析

### 摘要

${result.summary}

### 关键决策

${list(result.decisions)}

### 行动项

${list(result.actionItems)}

### 待跟进问题

${list(result.followUpQuestions)}`;
}

export function replaceAnalysisBlock(markdown: string, analysisMarkdown: string): string {
  return replaceBetween(markdown, ANALYSIS_START, ANALYSIS_END, analysisMarkdown);
}

export function updateMeetingFrontmatter(markdown: string, frontmatter: MeetingFrontmatter): string {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n?/);

  if (!match) {
    throw new Error("Cannot find YAML frontmatter");
  }

  return markdown.replace(match[0], `${serializeFrontmatter(frontmatter)}\n\n`);
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- tests/meeting-note-writer.test.ts
npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add src/meeting-note-writer.ts tests/meeting-note-writer.test.ts
git commit -m "feat: add markdown meeting note writer"
```

## Task 4: Implement Recording State Machine

**Files:**
- Create: `src/recording-controller.ts`
- Create: `tests/recording-controller.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

Create `tests/recording-controller.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { RecordingController } from "../src/recording-controller";

function makeController() {
  return new RecordingController({
    createSession: vi.fn(async () => ({
      id: "session-1",
      title: "会议记录",
      notePath: "Meetings/session.md",
      audioPath: "Attachments/session.webm",
      startedAt: new Date("2026-06-28T07:30:00.000Z"),
      status: "recording"
    })),
    startAudio: vi.fn(async () => undefined),
    pauseAudio: vi.fn(async () => undefined),
    resumeAudio: vi.fn(async () => undefined),
    stopAudio: vi.fn(async () => ({ durationSeconds: 1800 })),
    startTranscription: vi.fn(async () => undefined),
    stopTranscription: vi.fn(async () => undefined),
    analyze: vi.fn(async () => undefined),
    markInterrupted: vi.fn(async () => undefined)
  });
}

describe("RecordingController", () => {
  it("moves through start pause resume stop and analyze", async () => {
    const controller = makeController();

    await controller.start({ title: "设计评审" });
    expect(controller.getStatus()).toBe("recording");

    await controller.pause();
    expect(controller.getStatus()).toBe("paused");

    await controller.resume();
    expect(controller.getStatus()).toBe("recording");

    await controller.stop();
    expect(controller.getStatus()).toBe("completed");
  });

  it("rejects concurrent recordings", async () => {
    const controller = makeController();
    await controller.start({ title: "第一场" });

    await expect(controller.start({ title: "第二场" })).rejects.toThrow("A recording is already active");
  });

  it("marks active sessions as interrupted", async () => {
    const controller = makeController();
    await controller.start({ title: "会议" });
    await controller.interrupt(new Error("Obsidian unloaded"));

    expect(controller.getStatus()).toBe("interrupted");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/recording-controller.test.ts
```

Expected: FAIL because `src/recording-controller.ts` does not exist.

- [ ] **Step 3: Create `src/recording-controller.ts`**

```ts
import { MeetingSession, RecordingStatus } from "./domain";

interface ControllerDependencies {
  createSession(input: { title?: string }): Promise<MeetingSession>;
  startAudio(session: MeetingSession): Promise<void>;
  pauseAudio(): Promise<void>;
  resumeAudio(): Promise<void>;
  stopAudio(): Promise<{ durationSeconds: number }>;
  startTranscription(session: MeetingSession): Promise<void>;
  stopTranscription(): Promise<void>;
  analyze(session: MeetingSession): Promise<void>;
  markInterrupted(session: MeetingSession, error: Error): Promise<void>;
}

export class RecordingController {
  private status: RecordingStatus = "idle";
  private session: MeetingSession | null = null;

  constructor(private readonly deps: ControllerDependencies) {}

  getStatus(): RecordingStatus {
    return this.status;
  }

  getSession(): MeetingSession | null {
    return this.session;
  }

  async start(input: { title?: string }): Promise<MeetingSession> {
    if (this.status !== "idle" && this.status !== "completed" && this.status !== "failed" && this.status !== "interrupted") {
      throw new Error("A recording is already active");
    }

    this.status = "starting";
    const session = await this.deps.createSession(input);
    this.session = session;
    await this.deps.startAudio(session);
    await this.deps.startTranscription(session);
    this.status = "recording";
    return session;
  }

  async pause(): Promise<void> {
    if (this.status !== "recording") {
      throw new Error(`Cannot pause while status is ${this.status}`);
    }

    await this.deps.pauseAudio();
    this.status = "paused";
  }

  async resume(): Promise<void> {
    if (this.status !== "paused") {
      throw new Error(`Cannot resume while status is ${this.status}`);
    }

    await this.deps.resumeAudio();
    this.status = "recording";
  }

  async stop(): Promise<void> {
    if (!this.session) {
      throw new Error("No active recording session");
    }

    if (this.status !== "recording" && this.status !== "paused") {
      throw new Error(`Cannot stop while status is ${this.status}`);
    }

    const session = this.session;
    this.status = "stopping";
    await this.deps.stopTranscription();
    await this.deps.stopAudio();
    this.status = "analyzing";
    await this.deps.analyze(session);
    this.status = "completed";
  }

  async interrupt(error: Error): Promise<void> {
    if (!this.session) {
      this.status = "failed";
      return;
    }

    await this.deps.markInterrupted(this.session, error);
    this.status = "interrupted";
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- tests/recording-controller.test.ts
npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add src/recording-controller.ts tests/recording-controller.test.ts
git commit -m "feat: add recording state machine"
```

## Task 5: Implement OpenAI-Compatible Analysis Provider

**Files:**
- Create: `src/providers/openai-compatible-analysis-provider.ts`
- Create: `tests/openai-compatible-analysis-provider.test.ts`

- [ ] **Step 1: Write failing analysis provider tests**

Create `tests/openai-compatible-analysis-provider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleAnalysisProvider } from "../src/providers/openai-compatible-analysis-provider";

describe("OpenAICompatibleAnalysisProvider", () => {
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

    await expect(provider.analyze({ title: "会议", transcript: "内容", highlights: [] })).rejects.toThrow("AI analysis response was not valid JSON");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/openai-compatible-analysis-provider.test.ts
```

Expected: FAIL because provider file does not exist.

- [ ] **Step 3: Create `src/providers/openai-compatible-analysis-provider.ts`**

```ts
import { AnalysisProvider, AnalysisResult, HighlightMark } from "../domain";
import { OpenAICompatibleSettings } from "../settings";
import { formatTimestamp } from "../time";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseAnalysis(content: string): AnalysisResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI analysis response was not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI analysis response was not an object");
  }

  const object = parsed as Record<string, unknown>;
  return {
    summary: typeof object.summary === "string" ? object.summary : "",
    decisions: asList(object.decisions),
    actionItems: asList(object.actionItems),
    followUpQuestions: asList(object.followUpQuestions)
  };
}

function buildPrompt(input: { title: string; transcript: string; highlights: HighlightMark[] }): string {
  const highlights = input.highlights
    .map((mark) => `- [${formatTimestamp(mark.seconds)}] ${mark.label}`)
    .join("\n");

  return `请根据以下会议转写生成结构化会议纪要。只返回 JSON，不要返回 Markdown。

JSON 字段必须是：
- summary: string
- decisions: string[]
- actionItems: string[]
- followUpQuestions: string[]

会议标题：${input.title}

重点标记：
${highlights || "无"}

完整转写：
${input.transcript}`;
}

export class OpenAICompatibleAnalysisProvider implements AnalysisProvider {
  constructor(
    private readonly settings: OpenAICompatibleSettings,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async analyze(input: { title: string; transcript: string; highlights: HighlightMark[] }): Promise<AnalysisResult> {
    if (!this.settings.apiKey) {
      throw new Error("OpenAI-compatible API key is missing");
    }

    if (!this.settings.model) {
      throw new Error("OpenAI-compatible model is missing");
    }

    const baseUrl = this.settings.baseUrl.replace(/\/$/, "");
    const response = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`
      },
      body: JSON.stringify({
        model: this.settings.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是严谨的中文会议纪要助手，只输出可解析 JSON。"
          },
          {
            role: "user",
            content: buildPrompt(input)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`AI analysis request failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("AI analysis response did not include message content");
    }

    return parseAnalysis(content);
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- tests/openai-compatible-analysis-provider.test.ts
npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai-compatible-analysis-provider.ts tests/openai-compatible-analysis-provider.test.ts
git commit -m "feat: add openai compatible analysis provider"
```

## Task 6: Implement Alibaba Bailian Transcription Provider Boundary

**Files:**
- Create: `src/providers/alibaba-bailian-protocol.ts`
- Create: `src/providers/alibaba-bailian-transcription-provider.ts`
- Create: `tests/alibaba-bailian-protocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Create `tests/alibaba-bailian-protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildFinishTaskMessage,
  buildRunTaskMessage,
  parseBailianMessage
} from "../src/providers/alibaba-bailian-protocol";

describe("Alibaba Bailian protocol helpers", () => {
  it("builds a run-task message for real-time ASR", () => {
    const message = buildRunTaskMessage({
      taskId: "task-1",
      model: "paraformer-realtime-v2",
      sampleRate: 16000
    });

    expect(message.header.action).toBe("run-task");
    expect(message.header.task_id).toBe("task-1");
    expect(message.header.streaming).toBe("duplex");
    expect(message.payload.task_group).toBe("audio");
    expect(message.payload.task).toBe("asr");
    expect(message.payload.function).toBe("recognition");
    expect(message.payload.model).toBe("paraformer-realtime-v2");
    expect(message.payload.parameters.sample_rate).toBe(16000);
  });

  it("builds a finish-task message", () => {
    expect(buildFinishTaskMessage("task-1")).toEqual({
      header: {
        action: "finish-task",
        task_id: "task-1",
        streaming: "duplex"
      },
      payload: {}
    });
  });

  it("parses temporary and final text events", () => {
    const temporary = parseBailianMessage(JSON.stringify({
      header: { event: "result-generated" },
      payload: { output: { sentence: { text: "临时文本", sentence_end: false } } }
    }));
    const final = parseBailianMessage(JSON.stringify({
      header: { event: "result-generated" },
      payload: { output: { sentence: { text: "最终文本", begin_time: 1200, sentence_end: true } } }
    }));

    expect(temporary).toEqual({ type: "temporary", text: "临时文本" });
    expect(final).toEqual({ type: "final", text: "最终文本", startSeconds: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/alibaba-bailian-protocol.test.ts
```

Expected: FAIL because protocol helper file does not exist.

- [ ] **Step 3: Create `src/providers/alibaba-bailian-protocol.ts`**

```ts
export interface BailianRunTaskInput {
  taskId: string;
  model: string;
  sampleRate: number;
}

export type BailianParsedMessage =
  | { type: "started" }
  | { type: "temporary"; text: string }
  | { type: "final"; text: string; startSeconds: number }
  | { type: "finished" }
  | { type: "failed"; message: string }
  | { type: "ignored" };

export function buildRunTaskMessage(input: BailianRunTaskInput) {
  return {
    header: {
      action: "run-task",
      task_id: input.taskId,
      streaming: "duplex"
    },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: input.model,
      parameters: {
        format: "pcm",
        sample_rate: input.sampleRate
      }
    }
  };
}

export function buildFinishTaskMessage(taskId: string) {
  return {
    header: {
      action: "finish-task",
      task_id: taskId,
      streaming: "duplex"
    },
    payload: {}
  };
}

export function parseBailianMessage(raw: string): BailianParsedMessage {
  const data = JSON.parse(raw) as {
    header?: { event?: string; error_message?: string };
    payload?: { output?: { sentence?: { text?: string; begin_time?: number; sentence_end?: boolean } } };
  };

  const event = data.header?.event;

  if (event === "task-started") {
    return { type: "started" };
  }

  if (event === "task-finished") {
    return { type: "finished" };
  }

  if (event === "task-failed") {
    return { type: "failed", message: data.header?.error_message || "Alibaba Bailian task failed" };
  }

  if (event !== "result-generated") {
    return { type: "ignored" };
  }

  const sentence = data.payload?.output?.sentence;
  const text = sentence?.text?.trim();

  if (!text) {
    return { type: "ignored" };
  }

  if (sentence?.sentence_end) {
    return {
      type: "final",
      text,
      startSeconds: Math.floor((sentence.begin_time || 0) / 1000)
    };
  }

  return { type: "temporary", text };
}
```

- [ ] **Step 4: Create `src/providers/alibaba-bailian-transcription-provider.ts`**

```ts
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { TranscriptionProvider, TranscriptSegment } from "../domain";
import { AlibabaBailianSettings } from "../settings";
import {
  buildFinishTaskMessage,
  buildRunTaskMessage,
  parseBailianMessage
} from "./alibaba-bailian-protocol";

type Listener<T> = (value: T) => void;

export class AlibabaBailianTranscriptionProvider implements TranscriptionProvider {
  private socket: WebSocket | null = null;
  private readonly taskId = uuidv4();
  private temporaryListeners: Array<Listener<string>> = [];
  private finalListeners: Array<Listener<TranscriptSegment>> = [];
  private errorListeners: Array<Listener<Error>> = [];
  private finalCount = 0;

  constructor(private readonly settings: AlibabaBailianSettings) {}

  async connect(): Promise<void> {
    if (!this.settings.apiKey) {
      throw new Error("Alibaba Bailian API key is missing");
    }

    this.socket = new WebSocket(this.settings.endpoint, {
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`
      }
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("WebSocket was not created"));
        return;
      }

      this.socket.once("open", () => {
        this.socket?.send(JSON.stringify(buildRunTaskMessage({
          taskId: this.taskId,
          model: this.settings.model,
          sampleRate: this.settings.sampleRate
        })));
        resolve();
      });
      this.socket.once("error", reject);
    });

    this.socket.on("message", (data) => this.handleMessage(data.toString()));
    this.socket.on("error", (error) => this.emitError(error instanceof Error ? error : new Error(String(error))));
  }

  sendPcmFrame(frame: Int16Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(Buffer.from(frame.buffer));
  }

  async finish(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(buildFinishTaskMessage(this.taskId)));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  onTemporaryResult(listener: Listener<string>): void {
    this.temporaryListeners.push(listener);
  }

  onFinalSegment(listener: Listener<TranscriptSegment>): void {
    this.finalListeners.push(listener);
  }

  onError(listener: Listener<Error>): void {
    this.errorListeners.push(listener);
  }

  private handleMessage(raw: string): void {
    try {
      const parsed = parseBailianMessage(raw);

      if (parsed.type === "temporary") {
        this.temporaryListeners.forEach((listener) => listener(parsed.text));
      }

      if (parsed.type === "final") {
        this.finalCount += 1;
        this.finalListeners.forEach((listener) => listener({
          id: `${this.taskId}-${this.finalCount}`,
          startSeconds: parsed.startSeconds,
          text: parsed.text,
          final: true
        }));
      }

      if (parsed.type === "failed") {
        this.emitError(new Error(parsed.message));
      }
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private emitError(error: Error): void {
    this.errorListeners.forEach((listener) => listener(error));
  }
}
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npm test -- tests/alibaba-bailian-protocol.test.ts
npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Commit**

```bash
git add src/providers/alibaba-bailian-protocol.ts src/providers/alibaba-bailian-transcription-provider.ts tests/alibaba-bailian-protocol.test.ts
git commit -m "feat: add alibaba bailian transcription boundary"
```

## Task 7: Implement Audio Capture and PCM Helpers

**Files:**
- Create: `src/audio/pcm.ts`
- Create: `src/audio/audio-capture.ts`
- Create: `tests/pcm.test.ts`

- [ ] **Step 1: Write failing PCM tests**

Create `tests/pcm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { floatToInt16Pcm, mergeBlobs } from "../src/audio/pcm";

describe("PCM helpers", () => {
  it("converts float audio samples into signed 16-bit PCM", () => {
    const pcm = floatToInt16Pcm(new Float32Array([-1, -0.5, 0, 0.5, 1]));
    expect(Array.from(pcm)).toEqual([-32768, -16384, 0, 16383, 32767]);
  });

  it("merges blobs into one blob with the requested type", async () => {
    const blob = mergeBlobs([new Blob(["a"]), new Blob(["b"])], "audio/webm");
    expect(blob.type).toBe("audio/webm");
    expect(await blob.text()).toBe("ab");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/pcm.test.ts
```

Expected: FAIL because `src/audio/pcm.ts` does not exist.

- [ ] **Step 3: Create `src/audio/pcm.ts`**

```ts
export function floatToInt16Pcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

export function mergeBlobs(blobs: Blob[], type: string): Blob {
  return new Blob(blobs, { type });
}
```

- [ ] **Step 4: Create `src/audio/audio-capture.ts`**

```ts
import { floatToInt16Pcm, mergeBlobs } from "./pcm";

export interface AudioCaptureOptions {
  deviceId: string;
  mimeType: string;
}

export interface AudioCaptureResult {
  audioBlob: Blob;
  durationSeconds: number;
}

type PcmListener = (frame: Int16Array) => void;

export class AudioCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private pausedAt = 0;
  private pausedMillis = 0;
  private pcmListeners: PcmListener[] = [];

  onPcmFrame(listener: PcmListener): void {
    this.pcmListeners.push(listener);
  }

  async start(options: AudioCaptureOptions): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.chunks = [];
    this.startedAt = Date.now();
    this.pausedMillis = 0;
    this.pausedAt = 0;

    this.recorder = new MediaRecorder(this.stream, { mimeType: options.mimeType });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.recorder.start(1000);

    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatToInt16Pcm(input);
      this.pcmListeners.forEach((listener) => listener(pcm));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  async pause(): Promise<void> {
    if (this.recorder?.state === "recording") {
      this.recorder.pause();
      this.pausedAt = Date.now();
    }

    await this.context?.suspend();
  }

  async resume(): Promise<void> {
    if (this.pausedAt > 0) {
      this.pausedMillis += Date.now() - this.pausedAt;
      this.pausedAt = 0;
    }

    if (this.recorder?.state === "paused") {
      this.recorder.resume();
    }

    await this.context?.resume();
  }

  async stop(): Promise<AudioCaptureResult> {
    const recorder = this.recorder;

    if (!recorder) {
      throw new Error("Audio capture has not started");
    }

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        resolve();
      }
    });

    this.processor?.disconnect();
    this.source?.disconnect();
    await this.context?.close();
    this.stream?.getTracks().forEach((track) => track.stop());

    const endedAt = Date.now();
    const durationSeconds = Math.max(0, Math.floor((endedAt - this.startedAt - this.pausedMillis) / 1000));
    const audioBlob = mergeBlobs(this.chunks, recorder.mimeType || "audio/webm");

    this.stream = null;
    this.recorder = null;
    this.context = null;
    this.processor = null;
    this.source = null;

    return { audioBlob, durationSeconds };
  }
}
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npm test -- tests/pcm.test.ts
npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Commit**

```bash
git add src/audio/pcm.ts src/audio/audio-capture.ts tests/pcm.test.ts
git commit -m "feat: add audio capture helpers"
```

## Task 8: Implement Recovery Service

**Files:**
- Create: `src/recovery-service.ts`
- Create: `tests/recovery-service.test.ts`

- [ ] **Step 1: Write failing recovery tests**

Create `tests/recovery-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildInterruptedFrontmatter, shouldOfferRecovery } from "../src/recovery-service";

describe("recovery service helpers", () => {
  it("detects sessions that need recovery", () => {
    expect(shouldOfferRecovery({ status: "interrupted", audioPath: "a.webm" })).toBe(true);
    expect(shouldOfferRecovery({ status: "completed", audioPath: "a.webm" })).toBe(false);
    expect(shouldOfferRecovery({ status: "interrupted" })).toBe(false);
  });

  it("marks frontmatter as interrupted", () => {
    const frontmatter = buildInterruptedFrontmatter(
      {
        title: "会议",
        startedAt: "2026-06-28T15:30:00+08:00",
        status: "recording",
        audioPath: "Attachments/meeting.webm",
        transcriptionProvider: "alibaba-bailian",
        analysisProvider: "openai-compatible",
        analysisModel: "qwen-plus"
      },
      600
    );

    expect(frontmatter.status).toBe("interrupted");
    expect(frontmatter.durationSeconds).toBe(600);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/recovery-service.test.ts
```

Expected: FAIL because `src/recovery-service.ts` does not exist.

- [ ] **Step 3: Create `src/recovery-service.ts`**

```ts
import { MeetingFrontmatter } from "./domain";

export function shouldOfferRecovery(input: { status: string; audioPath?: string }): boolean {
  return input.status === "interrupted" && Boolean(input.audioPath);
}

export function buildInterruptedFrontmatter(frontmatter: MeetingFrontmatter, durationSeconds: number): MeetingFrontmatter {
  return {
    ...frontmatter,
    status: "interrupted",
    durationSeconds
  };
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npm test -- tests/recovery-service.test.ts
npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add src/recovery-service.ts tests/recovery-service.test.ts
git commit -m "feat: add recovery helpers"
```

## Task 9: Wire Obsidian Settings, View, and Main Plugin

**Files:**
- Create: `src/settings-tab.ts`
- Create: `src/recorder-view.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Replace `src/main.ts` with plugin wiring**

```ts
import { ItemView, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AudioCapture } from "./audio/audio-capture";
import {
  appendTranscriptSegment,
  buildAnalysisMarkdown,
  buildInitialMeetingNote,
  insertHighlightMark,
  replaceAnalysisBlock,
  updateMeetingFrontmatter
} from "./meeting-note-writer";
import { RecordingController } from "./recording-controller";
import { OpenAICompatibleAnalysisProvider } from "./providers/openai-compatible-analysis-provider";
import { AlibabaBailianTranscriptionProvider } from "./providers/alibaba-bailian-transcription-provider";
import { DEFAULT_SETTINGS, normalizeSettings, VoxoraSettings } from "./settings";
import { makeDefaultMeetingTitle, makeSafeFilename } from "./time";
import { MeetingFrontmatter, MeetingSession } from "./domain";
import { VoxoraSettingTab } from "./settings-tab";
import { RecorderView, VOXORA_VIEW_TYPE } from "./recorder-view";

export default class VoxoraPlugin extends Plugin {
  settings: VoxoraSettings = DEFAULT_SETTINGS;
  controller!: RecordingController;
  private currentNotePath = "";
  private currentFrontmatter: MeetingFrontmatter | null = null;
  private audioCapture: AudioCapture | null = null;
  private transcriptionProvider: AlibabaBailianTranscriptionProvider | null = null;

  async onload(): Promise<void> {
    this.settings = normalizeSettings((await this.loadData()) ?? {});
    this.addSettingTab(new VoxoraSettingTab(this.app, this));
    this.registerView(VOXORA_VIEW_TYPE, (leaf) => new RecorderView(leaf, this));

    this.controller = new RecordingController({
      createSession: (input) => this.createSession(input.title),
      startAudio: (session) => this.startAudio(session),
      pauseAudio: () => this.audioCapture?.pause() ?? Promise.resolve(),
      resumeAudio: () => this.audioCapture?.resume() ?? Promise.resolve(),
      stopAudio: () => this.stopAudio(),
      startTranscription: (session) => this.startTranscription(session),
      stopTranscription: () => this.stopTranscription(),
      analyze: (session) => this.analyzeSession(session),
      markInterrupted: (session) => this.markInterrupted(session)
    });

    this.addRibbonIcon("mic", "Voxora", () => this.activateView());
    this.addCommand({ id: "voxora-open-recorder", name: "Open recorder", callback: () => this.activateView() });
    this.addCommand({ id: "voxora-start-recording", name: "Start recording", callback: () => this.controller.start({}) });
    this.addCommand({ id: "voxora-stop-recording", name: "Stop recording", callback: () => this.controller.stop() });
    this.addCommand({ id: "voxora-reanalyze", name: "Reanalyze current meeting", callback: () => this.reanalyzeCurrentNote() });
  }

  onunload(): void {
    if (this.controller.getSession()) {
      this.controller.interrupt(new Error("Plugin unloaded"));
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VOXORA_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async startFromView(title?: string): Promise<void> {
    await this.controller.start({ title });
  }

  async pauseFromView(): Promise<void> {
    await this.controller.pause();
  }

  async resumeFromView(): Promise<void> {
    await this.controller.resume();
  }

  async stopFromView(): Promise<void> {
    await this.controller.stop();
  }

  async addHighlightFromView(): Promise<void> {
    const session = this.controller.getSession();
    if (!session || !this.currentNotePath) return;

    const elapsed = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
    await this.modifyNote((markdown) => insertHighlightMark(markdown, {
      id: uuidv4(),
      seconds: elapsed,
      label: "重点标记"
    }));
  }

  private async createSession(titleInput?: string): Promise<MeetingSession> {
    const now = new Date();
    const title = titleInput?.trim() || makeDefaultMeetingTitle(now);
    const notePath = normalizePath(`${this.settings.notesFolder}/${makeSafeFilename(title)}.md`);
    const audioPath = this.settings.saveAudio
      ? normalizePath(`${this.settings.recordingsFolder}/${makeSafeFilename(title)}.webm`)
      : undefined;

    this.currentFrontmatter = {
      title,
      startedAt: now.toISOString(),
      status: "recording",
      audioPath,
      transcriptionProvider: "alibaba-bailian",
      analysisProvider: "openai-compatible",
      analysisModel: this.settings.analysis.model
    };
    this.currentNotePath = notePath;
    await this.ensureFolder(this.settings.notesFolder);
    await this.app.vault.create(notePath, buildInitialMeetingNote(this.currentFrontmatter));

    return {
      id: uuidv4(),
      title,
      notePath,
      audioPath,
      startedAt: now,
      status: "recording"
    };
  }

  private async startAudio(session: MeetingSession): Promise<void> {
    this.audioCapture = new AudioCapture();
    this.audioCapture.onPcmFrame((frame) => this.transcriptionProvider?.sendPcmFrame(frame));
    await this.audioCapture.start({ deviceId: this.settings.defaultInputDeviceId, mimeType: "audio/webm" });
  }

  private async stopAudio(): Promise<{ durationSeconds: number }> {
    if (!this.audioCapture) {
      return { durationSeconds: 0 };
    }

    const result = await this.audioCapture.stop();

    if (this.currentFrontmatter?.audioPath && this.settings.saveAudio) {
      await this.ensureFolder(this.settings.recordingsFolder);
      await this.app.vault.adapter.writeBinary(this.currentFrontmatter.audioPath, await result.audioBlob.arrayBuffer());
    }

    if (this.currentFrontmatter) {
      this.currentFrontmatter = {
        ...this.currentFrontmatter,
        endedAt: new Date().toISOString(),
        durationSeconds: result.durationSeconds,
        status: "analyzing"
      };
      await this.modifyNote((markdown) => updateMeetingFrontmatter(markdown, this.currentFrontmatter!));
    }

    return { durationSeconds: result.durationSeconds };
  }

  private async startTranscription(session: MeetingSession): Promise<void> {
    this.transcriptionProvider = new AlibabaBailianTranscriptionProvider(this.settings.transcription);
    this.transcriptionProvider.onFinalSegment((segment) => {
      this.modifyNote((markdown) => appendTranscriptSegment(markdown, segment));
    });
    this.transcriptionProvider.onError((error) => {
      this.modifyNote((markdown) => appendTranscriptSegment(markdown, {
        id: uuidv4(),
        startSeconds: Math.floor((Date.now() - session.startedAt.getTime()) / 1000),
        text: `转写连接异常：${error.message}`,
        final: true
      }));
    });
    await this.transcriptionProvider.connect();
  }

  private async stopTranscription(): Promise<void> {
    await this.transcriptionProvider?.finish();
    this.transcriptionProvider?.close();
  }

  private async analyzeSession(session: MeetingSession): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(session.notePath);
    if (!(file instanceof TFile)) return;

    const markdown = await this.app.vault.read(file);
    const provider = new OpenAICompatibleAnalysisProvider(this.settings.analysis);
    const result = await provider.analyze({
      title: session.title,
      transcript: markdown,
      highlights: []
    });
    const updated = replaceAnalysisBlock(markdown, buildAnalysisMarkdown(result));
    await this.app.vault.modify(file, updated);

    if (this.currentFrontmatter) {
      this.currentFrontmatter = { ...this.currentFrontmatter, status: "completed" };
      await this.modifyNote((content) => updateMeetingFrontmatter(content, this.currentFrontmatter!));
    }
  }

  private async reanalyzeCurrentNote(): Promise<void> {
    const session = this.controller.getSession();
    if (!session) return;
    await this.analyzeSession(session);
  }

  private async markInterrupted(session: MeetingSession): Promise<void> {
    if (!this.currentFrontmatter) return;
    this.currentFrontmatter = {
      ...this.currentFrontmatter,
      status: "interrupted",
      durationSeconds: Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
    };
    await this.modifyNote((markdown) => updateMeetingFrontmatter(markdown, this.currentFrontmatter!));
  }

  private async modifyNote(mutator: (markdown: string) => string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.currentNotePath);
    if (!(file instanceof TFile)) return;

    const markdown = await this.app.vault.read(file);
    await this.app.vault.modify(file, mutator(markdown));
  }

  private async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder);
    const parts = normalized.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}
```

- [ ] **Step 2: Create `src/settings-tab.ts`**

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import VoxoraPlugin from "./main";

export class VoxoraSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VoxoraPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Voxora" });
    containerEl.createEl("p", {
      text: "API Key 保存在插件设置中。如果 Vault 或插件配置参与同步，Key 可能被同步或泄露。"
    });

    new Setting(containerEl)
      .setName("会议笔记目录")
      .addText((text) => text
        .setValue(this.plugin.settings.notesFolder)
        .onChange(async (value) => {
          this.plugin.settings.notesFolder = value.trim() || "Meetings";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("录音保存目录")
      .addText((text) => text
        .setValue(this.plugin.settings.recordingsFolder)
        .onChange(async (value) => {
          this.plugin.settings.recordingsFolder = value.trim() || "Attachments/Meetings";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("默认输入设备 ID")
      .addText((text) => text
        .setValue(this.plugin.settings.defaultInputDeviceId)
        .onChange(async (value) => {
          this.plugin.settings.defaultInputDeviceId = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("保存录音")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.saveAudio)
        .onChange(async (value) => {
          this.plugin.settings.saveAudio = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("停止后自动分析")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoAnalyze)
        .onChange(async (value) => {
          this.plugin.settings.autoAnalyze = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "阿里百炼语音转写" });

    new Setting(containerEl)
      .setName("API Key")
      .addText((text) => text
        .setPlaceholder("sk-...")
        .setValue(this.plugin.settings.transcription.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.transcription.apiKey = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("模型")
      .addText((text) => text
        .setValue(this.plugin.settings.transcription.model)
        .onChange(async (value) => {
          this.plugin.settings.transcription.model = value.trim() || "paraformer-realtime-v2";
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "AI 分析" });

    new Setting(containerEl)
      .setName("Base URL")
      .addText((text) => text
        .setValue(this.plugin.settings.analysis.baseUrl)
        .onChange(async (value) => {
          this.plugin.settings.analysis.baseUrl = value.trim() || "https://api.openai.com/v1";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("API Key")
      .addText((text) => text
        .setPlaceholder("sk-...")
        .setValue(this.plugin.settings.analysis.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.analysis.apiKey = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("模型")
      .addText((text) => text
        .setValue(this.plugin.settings.analysis.model)
        .onChange(async (value) => {
          this.plugin.settings.analysis.model = value.trim();
          await this.plugin.saveSettings();
        }));
  }
}
```

- [ ] **Step 3: Create `src/recorder-view.ts`**

```ts
import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
import VoxoraPlugin from "./main";

export const VOXORA_VIEW_TYPE = "voxora-recorder-view";

export class RecorderView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: VoxoraPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VOXORA_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Voxora Recorder";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("voxora-recorder-view");

    const status = container.createEl("div", {
      cls: "voxora-status",
      text: `状态：${this.plugin.controller?.getStatus?.() || "idle"}`
    });

    const titleInput = container.createEl("input", {
      type: "text",
      placeholder: "会议标题"
    });

    const liveText = container.createEl("div", {
      cls: "voxora-live-text",
      text: "临时识别结果会显示在这里。"
    });

    const controls = container.createEl("div", { cls: "voxora-controls" });

    new Setting(controls)
      .addButton((button) => button
        .setButtonText("开始")
        .setCta()
        .onClick(async () => {
          await this.plugin.startFromView(titleInput.value);
          status.setText(`状态：${this.plugin.controller.getStatus()}`);
        }));

    new Setting(controls)
      .addButton((button) => button
        .setButtonText("暂停")
        .onClick(async () => {
          await this.plugin.pauseFromView();
          status.setText(`状态：${this.plugin.controller.getStatus()}`);
        }));

    new Setting(controls)
      .addButton((button) => button
        .setButtonText("继续")
        .onClick(async () => {
          await this.plugin.resumeFromView();
          status.setText(`状态：${this.plugin.controller.getStatus()}`);
        }));

    new Setting(controls)
      .addButton((button) => button
        .setButtonText("停止")
        .onClick(async () => {
          await this.plugin.stopFromView();
          status.setText(`状态：${this.plugin.controller.getStatus()}`);
        }));

    new Setting(controls)
      .addButton((button) => button
        .setButtonText("标记重点")
        .onClick(async () => {
          await this.plugin.addHighlightFromView();
        }));
  }
}
```

- [ ] **Step 4: Typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit with code 0 and `main.js` is created.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/settings-tab.ts src/recorder-view.ts
git commit -m "feat: wire obsidian plugin ui"
```

## Task 10: Manual Verification in Obsidian Desktop

**Files:**
- Modify: none unless verification reveals a defect.

- [ ] **Step 1: Build the plugin bundle**

Run:

```bash
npm run build
```

Expected: command exits with code 0 and `main.js` exists beside `manifest.json`.

- [ ] **Step 2: Install into a test vault**

Copy these files into a test vault under `.obsidian/plugins/voxora/`:

```text
manifest.json
main.js
styles.css
```

Expected: Obsidian desktop shows Voxora in Community plugins after reloading plugins.

- [ ] **Step 3: Configure required settings**

In Obsidian settings for Voxora, set:

```text
会议笔记目录: Meetings
录音保存目录: Attachments/Meetings
保存录音: enabled
停止后自动分析: enabled
阿里百炼 API Key: a valid key
阿里百炼模型: paraformer-realtime-v2
AI Base URL: a valid OpenAI-compatible base URL ending in /v1
AI API Key: a valid key
AI 模型: a chat-completions model available at the configured base URL
```

Expected: settings persist after closing and reopening the settings tab.

- [ ] **Step 4: Run a 2-minute smoke meeting**

Use the Ribbon icon to open the recorder, enter `Voxora smoke test`, click start, speak for 2 minutes, click “标记重点” once, pause, resume, and stop.

Expected:

```text
Meetings/Voxora-smoke-test.md exists.
Attachments/Meetings/Voxora-smoke-test.webm exists when saving audio is enabled.
The note contains YAML frontmatter.
The note contains at least one timestamped transcript segment.
The note contains one highlight mark.
The note contains an AI 分析 section after analysis finishes.
```

- [ ] **Step 5: Verify reanalysis preserves transcript**

Edit one transcript line manually, run the “Reanalyze current meeting” command, and reopen the note.

Expected:

```text
The AI 分析 block changes.
The manually edited transcript line remains unchanged.
```

- [ ] **Step 6: Verify interrupted-session behavior**

Start a new recording, speak for 30 seconds, reload Obsidian before stopping, and reopen the generated note.

Expected:

```text
The note still exists.
The recording file exists when saving audio was enabled before reload.
The frontmatter status is interrupted.
```

- [ ] **Step 7: Commit verification fixes or record the passing state**

If code changed during verification:

```bash
git add src tests manifest.json styles.css
git commit -m "fix: stabilize manual obsidian verification"
```

If no code changed:

```bash
git status --short
```

Expected: no source changes are present.

import {
  Notice,
  Plugin,
  TFile,
  normalizePath,
  requestUrl,
  setIcon
} from "obsidian";

import type {
  MeetingFrontmatter,
  MeetingSession,
  RecordingStatus,
  AnalysisResult,
  TranscriptSegment,
  TranscriptionProvider
} from "./domain";
import { AudioCapture } from "./audio/audio-capture";
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
} from "./meeting-note-writer";
import { AlibabaBailianTranscriptionProvider } from "./providers/alibaba-bailian-transcription-provider";
import { OpenAICompatibleAnalysisProvider } from "./providers/openai-compatible-analysis-provider";
import { createRequestUrlHttpClient } from "./obsidian-http-client";
import { RecorderView, VOXORA_VIEW_TYPE } from "./recorder-view";
import { RecordingController } from "./recording-controller";
import {
  DEFAULT_SETTINGS,
  getMeetingsRootFolder,
  normalizeSettings,
  type VoxoraSettings
} from "./settings";
import { VoxoraSettingTab } from "./settings-tab";
import {
  makeDefaultMeetingTitle,
  makeSafeFilename
} from "./time";

function uuidv4(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatElapsedTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

type AudioCaptureInstance = InstanceType<
  typeof import("./audio/audio-capture").AudioCapture
>;
type RecorderViewInstance = InstanceType<typeof import("./recorder-view").RecorderView>;
type RecordingControllerInstance = InstanceType<
  typeof import("./recording-controller").RecordingController
>;

export default class VoxoraPlugin extends Plugin {
  settings: VoxoraSettings = DEFAULT_SETTINGS;
  controller!: RecordingControllerInstance;

  currentNotePath?: string;
  currentFrontmatter?: MeetingFrontmatter;
  currentMinutesPath?: string;
  audioCapture?: AudioCaptureInstance;
  transcriptionProvider?: TranscriptionProvider;
  private currentSession?: MeetingSession;
  private floatingControlsEl?: HTMLElement;
  private floatingStatusEl?: HTMLElement;
  private floatingTimeEl?: HTMLElement;
  private floatingButtons: Partial<
    Record<"start" | "pause" | "resume" | "stop" | "highlight", HTMLButtonElement>
  > = {};

  async onload(): Promise<void> {
    this.settings = normalizeSettings((await this.loadData()) ?? {});
    await this.saveSettings();

    this.addSettingTab(new VoxoraSettingTab(this.app, this));
    this.registerView(
      VOXORA_VIEW_TYPE,
      (leaf) => new RecorderView(leaf, this)
    );

    this.controller = new RecordingController({
      createSession: (input) => this.createSession(input),
      startAudio: (session) => this.startAudio(session),
      pauseAudio: (session) => this.pauseAudio(session),
      resumeAudio: (session) => this.resumeAudio(session),
      stopAudio: (session) => this.stopAudio(session),
      startTranscription: (session) => this.startTranscription(session),
      stopTranscription: (session) => this.stopTranscription(session),
      analyze: (session, recording) =>
        this.analyzeSession(session, recording, { abortIfInterrupted: true }),
      markInterrupted: (session, error) => this.markInterrupted(session, error)
    });

    this.addRibbonIcon("mic", "打开 Voxora 录音面板", () => {
      void this.captureCommandErrors(() => this.activateView());
    });

    this.addCommand({
      id: "open-recorder-view",
      name: "打开录音面板",
      callback: () => void this.captureCommandErrors(() => this.activateView())
    });
    this.addCommand({
      id: "start-recording",
      name: "开始录音",
      callback: () =>
        void this.captureCommandErrors(() => this.startFromView())
    });
    this.addCommand({
      id: "pause-recording",
      name: "暂停录音",
      callback: () =>
        void this.captureCommandErrors(() => this.pauseFromView())
    });
    this.addCommand({
      id: "resume-recording",
      name: "继续录音",
      callback: () =>
        void this.captureCommandErrors(() => this.resumeFromView())
    });
    this.addCommand({
      id: "stop-recording",
      name: "停止录音",
      callback: () => void this.captureCommandErrors(() => this.stopFromView())
    });
    this.addCommand({
      id: "add-highlight",
      name: "标记重点",
      callback: () =>
        void this.captureCommandErrors(() => this.addHighlightFromView())
    });
    this.addCommand({
      id: "reanalyze-current-meeting",
      name: "重新分析当前会议",
      callback: () =>
        void this.captureCommandErrors(() => this.reanalyzeCurrentNoteFromView())
    });

    this.createFloatingControls();
    this.updateFloatingControls();
    this.registerInterval(
      window.setInterval(() => this.updateFloatingControls(), 1000)
    );
  }

  async onunload(): Promise<void> {
    const unloadError = new Error("Plugin unloaded");

    if (this.controller?.getSession()) {
      try {
        await this.controller.interrupt(unloadError);
      } catch {
        // Best-effort cleanup during plugin unload.
      }
    }

    this.transcriptionProvider?.close();
    this.transcriptionProvider = undefined;

    if (this.audioCapture && this.currentSession) {
      try {
        await this.markInterrupted(this.currentSession, unloadError);
      } catch {
        // Best-effort cleanup during plugin unload.
      }
    } else if (this.audioCapture) {
      const capture = this.audioCapture;
      this.audioCapture = undefined;
      try {
        await capture.stop();
      } catch {
        // Best-effort cleanup during plugin unload.
      }
    }

    this.floatingControlsEl?.remove();
    this.floatingControlsEl = undefined;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VOXORA_VIEW_TYPE)[0];
    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VOXORA_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async startFromView(): Promise<void> {
    try {
      await this.controller.start({});
    } catch (error) {
      await this.persistFailedStatus();
      throw error;
    } finally {
      this.refreshRecorderViews();
    }
  }

  async pauseFromView(): Promise<void> {
    try {
      await this.controller.pause();
    } catch (error) {
      await this.persistFailedStatus();
      throw error;
    } finally {
      this.refreshRecorderViews();
    }
  }

  async resumeFromView(): Promise<void> {
    try {
      await this.controller.resume();
    } catch (error) {
      await this.persistFailedStatus();
      throw error;
    } finally {
      this.refreshRecorderViews();
    }
  }

  async stopFromView(): Promise<void> {
    try {
      await this.controller.stop();
    } catch (error) {
      await this.persistFailedStatus();
      throw error;
    } finally {
      this.refreshRecorderViews();
    }
  }

  async addHighlightFromView(): Promise<void> {
    const notePath = this.currentNotePath;
    if (!notePath) {
      throw new Error("当前没有会议笔记可标记。");
    }

    const seconds = this.elapsedSeconds();
    await this.modifyNote(notePath, (markdown) =>
      insertHighlightMark(markdown, {
        id: uuidv4(),
        seconds,
        label: "重点"
      })
    );
  }

  async reanalyzeCurrentNoteFromView(): Promise<void> {
    const session = this.controller.getSession() ?? this.currentSession;
    if (session) {
      await this.analyzeSession(session, {
        durationSeconds: this.currentFrontmatter?.durationSeconds ?? this.elapsedSeconds()
      });
      this.refreshRecorderViews();
      return;
    }

    if (!this.currentNotePath) {
      throw new Error("当前没有会议笔记可重新分析。");
    }

    const title = this.currentFrontmatter?.title ?? this.currentNotePath.split("/").pop()?.replace(/\.md$/, "") ?? "会议记录";
    await this.analyzeSession(
      {
        id: uuidv4(),
        title,
        notePath: this.currentNotePath,
        audioPath: this.currentFrontmatter?.audioPath,
        startedAt: this.currentFrontmatter?.startedAt
          ? new Date(this.currentFrontmatter.startedAt)
          : new Date(),
        status: "analyzing"
      },
      { durationSeconds: this.currentFrontmatter?.durationSeconds ?? 0 }
    );
    this.refreshRecorderViews();
  }

  async testTranscriptionConnection(): Promise<void> {
    const provider = new AlibabaBailianTranscriptionProvider(
      this.settings.transcription
    );

    try {
      await this.withTimeout(
        provider.connect(),
        10000,
        "转写连接测试超时，请检查 API Key、模型和网络。"
      );
    } finally {
      provider.close();
    }
  }

  async testAnalysisConnection(): Promise<void> {
    const provider = this.createAnalysisProvider();
    await this.withTimeout(
      provider.analyze({
        title: "Voxora 连接测试",
        transcript: "这是一段用于测试连接的简短文本。",
        highlights: []
      }),
      45000,
      "AI 连接测试超时，请检查 Base URL、API Key、模型和网络。"
    );
  }

  getRecorderStatusForView(): string {
    const labels: Record<RecordingStatus, string> = {
      idle: "待机",
      starting: "启动中",
      recording: "录音中",
      paused: "已暂停",
      stopping: "停止中",
      analyzing: "分析中",
      completed: "已完成",
      interrupted: "已中断",
      failed: "失败"
    };

    return labels[this.controller?.getStatus() ?? "idle"];
  }

  getRecorderStatusKeyForView(): RecordingStatus {
    return this.controller?.getStatus() ?? "idle";
  }

  private async createSession(_input: { title?: string }): Promise<MeetingSession> {
    const startedAt = new Date();
    const title = makeDefaultMeetingTitle(startedAt);
    const baseName = makeSafeFilename(title) || makeSafeFilename(makeDefaultMeetingTitle(startedAt));
    const meetingFolder = this.makeUniqueVaultFolderPath(
      getMeetingsRootFolder(this.settings),
      baseName
    );
    const notePath = normalizePath(`${meetingFolder}/转写.md`);
    const audioPath = normalizePath(`${meetingFolder}/录音.webm`);
    const minutesPath = normalizePath(`${meetingFolder}/会议纪要.md`);
    const frontmatter: MeetingFrontmatter = {
      title,
      startedAt: startedAt.toISOString(),
      status: "recording",
      audioPath,
      transcriptionProvider: "alibaba-bailian",
      analysisProvider: "openai-compatible",
      analysisModel: this.settings.analysis.model
    };

    await this.ensureFolder(meetingFolder);
    await this.app.vault.create(notePath, buildInitialTranscriptNote(frontmatter));
    await this.app.vault.create(minutesPath, buildInitialMeetingMinutes(frontmatter));
    await this.openMarkdownFile(notePath);

    const session: MeetingSession = {
      id: uuidv4(),
      title,
      notePath,
      audioPath,
      startedAt,
      status: "starting"
    };

    this.currentSession = session;
    this.currentNotePath = notePath;
    this.currentFrontmatter = frontmatter;
    this.currentMinutesPath = minutesPath;
    return session;
  }

  private async startAudio(_session: MeetingSession): Promise<void> {
    const capture = new AudioCapture();
    this.audioCapture = capture;
    capture.onPcmFrame((frame) => this.transcriptionProvider?.sendPcmFrame(frame));

    try {
      await capture.start({
        deviceId: this.settings.defaultInputDeviceId,
        mimeType: "audio/webm",
        pcmSampleRate: this.settings.transcription.sampleRate
      });
    } catch (error) {
      this.audioCapture = undefined;
      throw error;
    }
  }

  private async pauseAudio(_session: MeetingSession): Promise<void> {
    await this.audioCapture?.pause();
  }

  private async resumeAudio(_session: MeetingSession): Promise<void> {
    await this.audioCapture?.resume();
  }

  private async stopAudio(_session: MeetingSession): Promise<{ durationSeconds: number }> {
    const capture = this.audioCapture;
    if (!capture) {
      return { durationSeconds: 0 };
    }

    this.audioCapture = undefined;
    const result = await capture.stop();

    if (this.currentFrontmatter?.audioPath) {
      await this.ensureFolder(this.parentFolder(this.currentFrontmatter.audioPath));
      await this.app.vault.adapter.writeBinary(
        this.currentFrontmatter.audioPath,
        await result.audioBlob.arrayBuffer()
      );
    }

    if (this.currentFrontmatter && this.currentNotePath) {
      this.currentFrontmatter = {
        ...this.currentFrontmatter,
        endedAt: new Date().toISOString(),
        durationSeconds: result.durationSeconds,
      };
      await this.updateCurrentFrontmatter();
    }

    return { durationSeconds: result.durationSeconds };
  }

  private async startTranscription(_session: MeetingSession): Promise<void> {
    const provider = new AlibabaBailianTranscriptionProvider(
      this.settings.transcription
    );
    this.transcriptionProvider = provider;

    provider.onTemporaryResult((text) => {
      for (const view of this.getOpenRecorderViews()) {
        view.setTemporaryText(text);
      }
    });
    provider.onFinalSegment((segment) => {
      void this.captureCommandErrors(() => this.appendTranscript(segment));
    });
    provider.onError((error) => {
      void this.handleTranscriptionError(error);
    });

    try {
      await provider.connect();
    } catch (error) {
      this.transcriptionProvider = undefined;
      provider.close();
      throw error;
    }
  }

  private async stopTranscription(_session: MeetingSession): Promise<void> {
    const provider = this.transcriptionProvider;
    if (!provider) {
      return;
    }

    try {
      await provider.finish();
    } finally {
      provider.close();
      if (this.transcriptionProvider === provider) {
        this.transcriptionProvider = undefined;
      }
    }
  }

  private async analyzeSession(
    session: MeetingSession,
    recording: { durationSeconds: number },
    options: { abortIfInterrupted?: boolean } = {}
  ): Promise<void> {
    if (this.currentFrontmatter && this.currentNotePath === session.notePath) {
      this.currentFrontmatter = {
        ...this.currentFrontmatter,
        durationSeconds: recording.durationSeconds,
        status: "analyzing"
      };
      await this.updateCurrentFrontmatter();
    }

    if (!this.settings.enableAnalysis) {
      if (this.shouldAbortAnalysisWrite(session, options)) {
        return;
      }

      if (this.currentFrontmatter && this.currentNotePath === session.notePath) {
        this.currentFrontmatter = {
          ...this.currentFrontmatter,
          durationSeconds: recording.durationSeconds,
          status: "completed"
        };
        await this.updateCurrentFrontmatter();
      }
      return;
    }

    const minutesPath =
      this.currentMinutesPath ??
      this.makeUniqueVaultPath(
        this.parentFolder(session.notePath),
        "会议纪要",
        "md"
      );
    await this.ensureFolder(this.parentFolder(minutesPath));

    if (this.shouldAbortAnalysisWrite(session, options)) {
      return;
    }

    await this.ensureMinutesFile(minutesPath, session);
    await this.modifyNote(minutesPath, (currentMarkdown) =>
      replaceAnalysisBlock(
        currentMarkdown,
        buildAnalysisPendingMarkdown("AI 会议纪要生成中，请稍候。")
      )
    );
    this.currentMinutesPath = minutesPath;

    const markdown = await this.readNote(session.notePath);
    const provider = this.createAnalysisProvider();
    let result: AnalysisResult;
    try {
      result = await provider.analyze({
        title: session.title,
        transcript: markdown,
        highlights: []
      });
    } catch (error) {
      await this.modifyNote(minutesPath, (currentMarkdown) =>
        replaceAnalysisBlock(
          currentMarkdown,
          buildAnalysisErrorMarkdown(this.messageFromError(error))
        )
      );
      throw error;
    }
    const analysisMarkdown = buildAnalysisMarkdown(result);

    if (this.shouldAbortAnalysisWrite(session, options)) {
      return;
    }

    await this.modifyNote(minutesPath, (currentMarkdown) =>
      replaceAnalysisBlock(currentMarkdown, analysisMarkdown)
    );

    if (this.shouldAbortAnalysisWrite(session, options)) {
      return;
    }

    if (this.currentFrontmatter && this.currentNotePath === session.notePath) {
      this.currentFrontmatter = {
        ...this.currentFrontmatter,
        durationSeconds: recording.durationSeconds,
        status: "completed"
      };
      await this.updateCurrentFrontmatter();
    }
  }

  private shouldAbortAnalysisWrite(
    session: MeetingSession,
    options: { abortIfInterrupted?: boolean }
  ): boolean {
    if (!options.abortIfInterrupted) {
      return false;
    }

    if (this.currentSession?.id !== session.id) {
      return false;
    }

    const controllerStatus = this.controller?.getStatus();
    return (
      controllerStatus === "interrupted" ||
      controllerStatus === "failed" ||
      this.currentFrontmatter?.status === "interrupted" ||
      this.currentFrontmatter?.status === "failed"
    );
  }

  private createAnalysisProvider(): OpenAICompatibleAnalysisProvider {
    return new OpenAICompatibleAnalysisProvider(
      this.settings.analysis,
      createRequestUrlHttpClient(requestUrl)
    );
  }

  private async markInterrupted(
    _session: MeetingSession,
    _error: Error
  ): Promise<void> {
    const provider = this.transcriptionProvider;
    if (provider) {
      try {
        provider.close();
      } catch {
        // Best-effort interruption cleanup.
      } finally {
        this.transcriptionProvider = undefined;
      }
    }

    try {
      await this.stopAudio(_session);
    } catch {
      // Preserve interrupted state even if audio cleanup cannot finish.
    }

    if (this.currentFrontmatter && this.currentNotePath) {
      this.currentFrontmatter = {
        ...this.currentFrontmatter,
        status: "interrupted",
        durationSeconds: this.currentFrontmatter.durationSeconds ?? this.elapsedSeconds()
      };
      await this.updateCurrentFrontmatter();
    }
  }

  private async appendTranscript(segment: TranscriptSegment): Promise<void> {
    await this.modifyCurrentNote((markdown) =>
      appendTranscriptSegment(markdown, segment)
    );
  }

  private async handleTranscriptionError(error: Error): Promise<void> {
    new Notice(`转写连接异常：${error.message}`);
    if (!this.currentNotePath) {
      return;
    }

    await this.appendTranscript({
      id: uuidv4(),
      startSeconds: this.elapsedSeconds(),
      text: `转写连接异常：${error.message}`,
      final: true
    });
  }

  private async updateCurrentFrontmatter(): Promise<void> {
    if (!this.currentNotePath || !this.currentFrontmatter) {
      return;
    }

    const frontmatter = this.currentFrontmatter as MeetingFrontmatter;
    await this.modifyCurrentNote((markdown) =>
      updateMeetingFrontmatter(markdown, frontmatter)
    );

    if (this.currentMinutesPath && this.currentMinutesPath !== this.currentNotePath) {
      await this.modifyNote(this.currentMinutesPath, (markdown) =>
        updateMeetingFrontmatter(markdown, frontmatter)
      );
    }
  }

  private async modifyCurrentNote(
    mutator: (markdown: string) => string
  ): Promise<void> {
    if (!this.currentNotePath) {
      throw new Error("当前没有会议笔记。");
    }

    await this.modifyNote(this.currentNotePath, mutator);
  }

  private async modifyNote(
    path: string,
    mutator: (markdown: string) => string
  ): Promise<void> {
    const file = this.getMarkdownFile(path);
    const markdown = await this.app.vault.read(file);
    await this.app.vault.modify(file, mutator(markdown));
  }

  private async readNote(path: string): Promise<string> {
    return this.app.vault.read(this.getMarkdownFile(path));
  }

  private async openMarkdownFile(path: string): Promise<void> {
    const file = this.getMarkdownFile(path);
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  private async ensureMinutesFile(
    path: string,
    session: MeetingSession
  ): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (existing instanceof TFile) {
      return;
    }

    const frontmatter: MeetingFrontmatter =
      this.currentFrontmatter && this.currentNotePath === session.notePath
        ? this.currentFrontmatter
        : {
            title: session.title,
            startedAt: session.startedAt.toISOString(),
            status: "analyzing",
            audioPath: session.audioPath,
            transcriptionProvider: "alibaba-bailian",
            analysisProvider: "openai-compatible",
            analysisModel: this.settings.analysis.model
          };

    await this.writeMarkdownFile(path, buildInitialMeetingMinutes(frontmatter));
  }

  private getMarkdownFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      throw new Error(`找不到会议笔记：${path}`);
    }

    return file;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder.trim());
    if (normalized === "" || normalized === "/" || normalized === ".") {
      return;
    }

    const parts = normalized.split("/").filter((part) => part.length > 0);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing) {
        continue;
      }
      await this.app.vault.createFolder(current);
    }
  }

  private makeUniqueVaultPath(folder: string, baseName: string, extension: string): string {
    const normalizedFolder = normalizePath(folder.trim());
    const prefix =
      normalizedFolder === "" || normalizedFolder === "." ? "" : `${normalizedFolder}/`;

    let index = 1;
    while (true) {
      const suffix = index === 1 ? "" : `-${index}`;
      const path = normalizePath(`${prefix}${baseName}${suffix}.${extension}`);
      if (!this.app.vault.getAbstractFileByPath(path)) {
        return path;
      }
      index += 1;
    }
  }

  private makeUniqueVaultFolderPath(rootFolder: string, baseName: string): string {
    const normalizedRoot = normalizePath(rootFolder.trim());
    const prefix =
      normalizedRoot === "" || normalizedRoot === "." ? "" : `${normalizedRoot}/`;

    let index = 1;
    while (true) {
      const suffix = index === 1 ? "" : `-${index}`;
      const path = normalizePath(`${prefix}${baseName}${suffix}`);
      if (!this.app.vault.getAbstractFileByPath(path)) {
        return path;
      }
      index += 1;
    }
  }

  private parentFolder(path: string): string {
    return normalizePath(path).split("/").slice(0, -1).join("/");
  }

  private async writeMarkdownFile(path: string, markdown: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, markdown);
      return;
    }

    await this.app.vault.create(normalizedPath, markdown);
  }

  private getOpenRecorderViews(): RecorderViewInstance[] {
    return this.app.workspace
      .getLeavesOfType(VOXORA_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is RecorderViewInstance => view instanceof RecorderView);
  }

  private refreshRecorderViews(): void {
    for (const view of this.getOpenRecorderViews()) {
      view.refreshStatus();
    }
    this.updateFloatingControls();
  }

  private async persistFailedStatus(): Promise<void> {
    if (this.controller?.getStatus() !== "failed") {
      return;
    }

    if (!this.currentFrontmatter || !this.currentNotePath) {
      return;
    }

    this.currentFrontmatter = {
      ...this.currentFrontmatter,
      status: "failed"
    };

    try {
      await this.updateCurrentFrontmatter();
    } catch {
      // Preserve the original operation failure for the caller.
    }
  }

  private elapsedSeconds(): number {
    const status = this.controller?.getStatus();
    if (
      this.currentFrontmatter?.durationSeconds !== undefined &&
      (status === "analyzing" ||
        status === "completed" ||
        status === "failed" ||
        status === "interrupted" ||
        this.currentFrontmatter.endedAt !== undefined)
    ) {
      return this.currentFrontmatter.durationSeconds;
    }

    const startedAt =
      this.currentSession?.startedAt ??
      (this.currentFrontmatter?.startedAt
        ? new Date(this.currentFrontmatter.startedAt)
        : undefined);

    if (!startedAt) {
      return 0;
    }

    return Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
  }

  private async captureCommandErrors(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(this.messageFromError(error));
    } finally {
      this.updateFloatingControls();
    }
  }

  private messageFromError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private createFloatingControls(): void {
    const container = document.createElement("div");
    container.className = "voxora-floating-controls";

    const metaEl = document.createElement("div");
    metaEl.className = "voxora-floating-meta";
    container.appendChild(metaEl);

    this.floatingStatusEl = document.createElement("div");
    this.floatingStatusEl.className = "voxora-floating-status";
    metaEl.appendChild(this.floatingStatusEl);

    this.floatingTimeEl = document.createElement("div");
    this.floatingTimeEl.className = "voxora-floating-time";
    metaEl.appendChild(this.floatingTimeEl);

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "voxora-floating-buttons";
    container.appendChild(buttonGroup);

    this.floatingButtons = {
      start: this.createFloatingButton("开始录音", "mic", () => this.startFromView()),
      pause: this.createFloatingButton("暂停录音", "pause", () => this.pauseFromView()),
      resume: this.createFloatingButton("继续录音", "play", () => this.resumeFromView()),
      stop: this.createFloatingButton("停止录音", "square", () => this.stopFromView()),
      highlight: this.createFloatingButton("标记重点", "highlighter", () =>
        this.addHighlightFromView()
      )
    };

    for (const button of Object.values(this.floatingButtons)) {
      if (button) {
        buttonGroup.appendChild(button);
      }
    }

    document.body.appendChild(container);
    this.floatingControlsEl = container;
    this.enableFloatingDrag(container);
  }

  private createFloatingButton(
    label: string,
    icon: string,
    action: () => Promise<void>
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "voxora-floating-button";
    button.type = "button";
    button.title = label;
    button.ariaLabel = label;
    setIcon(button, icon);
    button.addEventListener("click", () => {
      void this.captureCommandErrors(action);
    });
    return button;
  }

  private updateFloatingControls(): void {
    const status = this.controller?.getStatus() ?? "idle";
    const label = this.getRecorderStatusForView();
    this.floatingControlsEl?.setAttribute("data-status", status);

    if (this.floatingStatusEl) {
      this.floatingStatusEl.setText(label);
    }

    if (this.floatingTimeEl) {
      this.floatingTimeEl.setText(formatElapsedTime(this.elapsedSeconds()));
    }

    const isRecording = status === "recording";
    const isPaused = status === "paused";
    const isBusy =
      status === "starting" || status === "stopping" || status === "analyzing";

    this.setFloatingButtonDisabled("start", isRecording || isPaused || isBusy);
    this.setFloatingButtonDisabled("pause", !isRecording);
    this.setFloatingButtonDisabled("resume", !isPaused);
    this.setFloatingButtonDisabled("stop", !isRecording && !isPaused);
    this.setFloatingButtonDisabled("highlight", !isRecording && !isPaused);
  }

  private setFloatingButtonDisabled(
    key: keyof typeof this.floatingButtons,
    disabled: boolean
  ): void {
    const button = this.floatingButtons[key];
    if (button) {
      button.disabled = disabled;
    }
  }

  private enableFloatingDrag(container: HTMLElement): void {
    let pointerId: number | undefined;
    let offsetX = 0;
    let offsetY = 0;

    const move = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) {
        return;
      }

      const maxLeft = Math.max(0, window.innerWidth - container.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - container.offsetHeight);
      const left = Math.min(Math.max(0, event.clientX - offsetX), maxLeft);
      const top = Math.min(Math.max(0, event.clientY - offsetY), maxTop);
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.right = "auto";
      container.style.bottom = "auto";
    };

    const stop = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) {
        return;
      }

      pointerId = undefined;
      container.removeClass("is-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    container.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button")) {
        return;
      }

      const rect = container.getBoundingClientRect();
      pointerId = event.pointerId;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      container.style.left = `${rect.left}px`;
      container.style.top = `${rect.top}px`;
      container.style.right = "auto";
      container.style.bottom = "auto";
      container.addClass("is-dragging");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    });
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

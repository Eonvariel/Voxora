import { ItemView, WorkspaceLeaf } from "obsidian";

import type VoxoraPlugin from "./main";
import type { RecordingStatus } from "./domain";

export const VOXORA_VIEW_TYPE = "voxora-recorder-view";

type RecorderStatusProvider = {
  getRecorderStatusForView?(): string;
  getRecorderStatusKeyForView?(): RecordingStatus;
};

type RecorderViewPlugin = VoxoraPlugin & RecorderStatusProvider;

export class RecorderView extends ItemView {
  private readonly plugin: RecorderViewPlugin;
  private statusCardEl?: HTMLElement;
  private statusLabelEl?: HTMLElement;
  private statusHintEl?: HTMLElement;
  private temporaryTextEl?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: RecorderViewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VOXORA_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Voxora 录音";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("voxora-recorder-view");

    container.createEl("h2", { text: "会议录音" });

    this.statusCardEl = container.createDiv({ cls: "voxora-status-card" });
    this.statusCardEl.createDiv({ cls: "voxora-status-dot" });
    const statusTextEl = this.statusCardEl.createDiv({
      cls: "voxora-status-copy"
    });
    statusTextEl.createDiv({ cls: "voxora-status-caption", text: "录音状态" });
    this.statusLabelEl = statusTextEl.createDiv({
      cls: "voxora-status-label"
    });
    this.statusHintEl = this.statusCardEl.createDiv({
      cls: "voxora-status-hint"
    });
    this.refreshStatus();

    container.createEl("h3", { text: "临时识别结果" });
    this.temporaryTextEl = container.createDiv({
      cls: "voxora-live-text",
      text: "暂无识别内容"
    });
  }

  setTemporaryText(text: string): void {
    if (!this.temporaryTextEl) {
      return;
    }

    this.temporaryTextEl.setText(text.trim().length > 0 ? text : "暂无识别内容");
  }

  refreshStatus(fallback = "待机"): void {
    if (!this.statusCardEl || !this.statusLabelEl || !this.statusHintEl) {
      return;
    }

    const status = this.plugin.getRecorderStatusForView?.() ?? fallback;
    const statusKey = this.plugin.getRecorderStatusKeyForView?.() ?? "idle";
    this.statusCardEl.setAttribute("data-status", statusKey);
    this.statusLabelEl.setText(status);
    this.statusHintEl.setText(statusHint(statusKey));
  }
}

function statusHint(status: RecordingStatus): string {
  const hints: Record<RecordingStatus, string> = {
    idle: "使用右下角悬浮气泡开始录音",
    starting: "正在连接麦克风和转写服务",
    recording: "正在录音并接收实时识别",
    paused: "录音已暂停，可继续或停止",
    stopping: "正在保存录音和转写内容",
    analyzing: "正在生成 AI 总结",
    completed: "会议记录已完成",
    interrupted: "录音被中断，已尽量保留内容",
    failed: "录音失败，请检查设置后重试"
  };

  return hints[status];
}

import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import type VoxoraPlugin from "./main";
import { DEFAULT_SETTINGS, type VoxoraSettings } from "./settings";

type VoxoraSettingsPlugin = VoxoraPlugin & {
  settings: VoxoraSettings;
  saveSettings(): Promise<void>;
  testTranscriptionConnection(): Promise<void>;
  testAnalysisConnection(): Promise<void>;
};

function textOrDefault(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sampleRateOrDefault(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_SETTINGS.transcription.sampleRate;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SETTINGS.transcription.sampleRate;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function folderOptions(app: App): Record<string, string> {
  const options: Record<string, string> = {};
  for (const folder of app.vault.getAllFolders(true)) {
    const value = folder.path;
    options[value] = value === "/" ? "/" : value;
  }

  return options;
}

function ensureOption(
  options: Record<string, string>,
  value: string,
  label = value
): Record<string, string> {
  if (value.trim().length === 0) {
    return options;
  }

  return {
    ...options,
    [value]: label
  };
}

async function audioInputOptions(
  selectedDeviceId: string
): Promise<Record<string, string>> {
  const options: Record<string, string> = {
    "": "系统默认麦克风"
  };

  if (!navigator.mediaDevices?.enumerateDevices) {
    return ensureOption(options, selectedDeviceId, selectedDeviceId);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  let index = 1;
  for (const device of devices) {
    if (device.kind !== "audioinput") {
      continue;
    }

    options[device.deviceId] = device.label || `麦克风 ${index}`;
    index += 1;
  }

  return ensureOption(options, selectedDeviceId, selectedDeviceId);
}

export class VoxoraSettingTab extends PluginSettingTab {
  private readonly plugin: VoxoraSettingsPlugin;

  constructor(app: App, plugin: VoxoraSettingsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Voxora 设置" });

    this.addFolderDropdown(
      containerEl,
      "会议文件目录",
      "每次会议会在此目录下创建独立文件夹，会议笔记、录音和 AI 分析都保存在其中。",
      this.plugin.settings.meetingFolder,
      async (value) => {
        this.plugin.settings.meetingFolder = textOrDefault(
          value,
          DEFAULT_SETTINGS.meetingFolder
        );
        await this.plugin.saveSettings();
      }
    );

    void this.addAudioInputDropdown(containerEl);

    containerEl.createEl("h3", { text: "阿里百炼语音转写" });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("用于调用阿里百炼实时语音转写。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.transcription.apiKey).onChange(
          async (value) => {
            this.plugin.settings.transcription.apiKey = value.trim();
            await this.plugin.saveSettings();
          }
        );
      });

    new Setting(containerEl)
      .setName("模型")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.transcription.model)
          .setValue(this.plugin.settings.transcription.model)
          .onChange(async (value) => {
            this.plugin.settings.transcription.model = textOrDefault(
              value,
              DEFAULT_SETTINGS.transcription.model
            );
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("采样率")
      .setDesc("单位 Hz。")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.transcription.sampleRate))
          .setValue(String(this.plugin.settings.transcription.sampleRate))
          .onChange(async (value) => {
            this.plugin.settings.transcription.sampleRate =
              sampleRateOrDefault(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("WebSocket Endpoint")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.transcription.endpoint)
          .setValue(this.plugin.settings.transcription.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.transcription.endpoint = textOrDefault(
              value,
              DEFAULT_SETTINGS.transcription.endpoint
            );
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("测试转写连接")
      .setDesc("验证阿里百炼 API Key、模型和 WebSocket Endpoint。")
      .addButton((button) =>
        button.setButtonText("测试连接").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.testTranscriptionConnection();
            new Notice("转写连接测试成功。");
          } catch (error) {
            new Notice(`转写连接测试失败：${messageFromError(error)}`, 8000);
          } finally {
            button.setDisabled(false);
          }
        })
      );

    containerEl.createEl("h3", { text: "AI 分析" });
    containerEl.createEl("p", {
      cls: "voxora-api-warning",
      text:
        "API Key 保存在插件设置里；如果 Vault 或插件配置参与同步，Key 可能同步或泄露。"
    });

    new Setting(containerEl)
      .setName("启用 AI 总结")
      .setDesc("录音停止后自动生成会议总结和行动项。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAnalysis).onChange(
          async (value) => {
            this.plugin.settings.enableAnalysis = value;
            await this.plugin.saveSettings();
          }
        )
      );

    new Setting(containerEl)
      .setName("Base URL")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.analysis.baseUrl)
          .setValue(this.plugin.settings.analysis.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.analysis.baseUrl = textOrDefault(
              value,
              DEFAULT_SETTINGS.analysis.baseUrl
            );
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("用于调用 OpenAI 兼容的分析接口。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.analysis.apiKey).onChange(
          async (value) => {
            this.plugin.settings.analysis.apiKey = value.trim();
            await this.plugin.saveSettings();
          }
        );
      });

    new Setting(containerEl)
      .setName("模型")
      .addText((text) =>
        text.setValue(this.plugin.settings.analysis.model).onChange(
          async (value) => {
            this.plugin.settings.analysis.model = value.trim();
            await this.plugin.saveSettings();
          }
        )
      );

    new Setting(containerEl)
      .setName("测试 AI 连接")
      .setDesc("验证 Base URL、API Key 和模型是否可用于分析。")
      .addButton((button) =>
        button.setButtonText("测试连接").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.testAnalysisConnection();
            new Notice("AI 连接测试成功。");
          } catch (error) {
            new Notice(`AI 连接测试失败：${messageFromError(error)}`, 8000);
          } finally {
            button.setDisabled(false);
          }
        })
      );
  }

  private addFolderDropdown(
    containerEl: HTMLElement,
    name: string,
    description: string,
    currentValue: string,
    onChange: (value: string) => Promise<void>
  ): void {
    const options = ensureOption(
      folderOptions(this.app),
      currentValue,
      `${currentValue}（将自动创建）`
    );

    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(options)
          .setValue(currentValue)
          .onChange(onChange)
      );
  }

  private async addAudioInputDropdown(containerEl: HTMLElement): Promise<void> {
    const setting = new Setting(containerEl)
      .setName("默认输入设备")
      .setDesc("选择录音使用的麦克风；授权前设备名称可能为空。");
    const selectedDeviceId = this.plugin.settings.defaultInputDeviceId;
    let options: Record<string, string>;

    try {
      options = await audioInputOptions(selectedDeviceId);
    } catch {
      options = ensureOption(
        { "": "系统默认麦克风" },
        selectedDeviceId,
        selectedDeviceId
      );
      setting.setDesc("无法读取麦克风列表；可先使用系统默认麦克风。");
    }

    setting.addDropdown((dropdown) =>
      dropdown
        .addOptions(options)
        .setValue(selectedDeviceId)
        .onChange(async (value) => {
          this.plugin.settings.defaultInputDeviceId = value.trim();
          await this.plugin.saveSettings();
        })
    );
    setting.addButton((button) =>
      button.setButtonText("刷新").onClick(() => this.display())
    );
  }
}

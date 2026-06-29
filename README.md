# Voxora

**Record meetings, transcribe in real time, and generate AI meeting minutes — all inside Obsidian.**

一款运行在 Obsidian 桌面端的会议录制插件：支持实时语音转写与 AI 会议纪要生成，让你的笔记与会议记录融为一体。

---

## English

Voxora turns Obsidian into a meeting workspace. Hit record, speak naturally, and watch your words appear as a live transcript. When the meeting ends, an AI model summarizes the discussion into structured meeting minutes — decisions, action items, and key points — saved directly as a Markdown note in your vault.

### Features

- 🎙️ **In-app recording** — capture audio from any microphone, right inside Obsidian (desktop only)
- 📝 **Real-time transcription** — powered by Alibaba Bailian (Paraformer) with streaming WebSocket
- 🤖 **AI meeting minutes** — automatically analyze transcripts with any OpenAI-compatible model
- 📁 **Organized notes** — each meeting becomes a structured Markdown file with frontmatter, transcript, and analysis
- 💾 **Audio archival** — optionally save the raw audio recording alongside the note
- 🔄 **Crash recovery** — recordings survive unexpected shutdowns
- ⚙️ **Flexible providers** — plug in any OpenAI-compatible endpoint (OpenAI, Ollama, local LLMs, etc.) for analysis

### Installation

1. Open Obsidian → **Settings** → **Community plugins**
2. Browse for **Voxora** and click **Install**
3. Enable the plugin, then open **Voxora Settings** to configure your API keys:
   - **Transcription** — Alibaba Bailian API key
   - **Analysis** — any OpenAI-compatible base URL + API key + model name
4. Use the ribbon icon or command palette to start a new meeting

### Manual Installation

If you prefer to install manually:

```bash
git clone https://github.com/Eonvariel/Voxora.git
cd obsidian-voxora
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `<your-vault>/.obsidian/plugins/voxora/`.

### Requirements

- Obsidian ≥ 1.5.0
- Desktop (Electron) version of Obsidian — mobile is not supported
- An Alibaba Bailian API key for transcription
- An OpenAI-compatible API endpoint for analysis

---

## 中文

Voxora 把 Obsidian 变成一个会议工作台。点击录制，自然开口说话，文字便会实时出现在转写区。会议结束后，AI 模型会将转写内容整理成结构化的会议纪要 —— 决策、待办事项、重点摘要 —— 并以 Markdown 笔记的形式直接保存在你的仓库中。

### 功能特性

- 🎙️ **应用内录制** —— 直接在 Obsidian 中捕获任意麦克风的声音（仅桌面端）
- 📝 **实时转写** —— 基于阿里巴巴百炼（Paraformer）的流式 WebSocket 语音识别
- 🤖 **AI 会议纪要** —— 支持任意 OpenAI 兼容模型，自动分析转写内容
- 📁 **笔记整理** —— 每场会议自动生成带 frontmatter、转写原文与分析结果的 Markdown 文件
- 💾 **音频归档** —— 可选保存原始录音文件，与笔记一同存放
- 🔄 **崩溃恢复** —— 意外关闭也不会丢失正在录制的音频
- ⚙️ **灵活的提供商** —— 分析功能可接入任意 OpenAI 兼容接口（OpenAI、Ollama、本地大模型等）

### 安装方法

1. 打开 Obsidian → **设置** → **第三方插件**
2. 搜索 **Voxora** 并点击 **安装**
3. 启用插件后，打开 **Voxora 设置** 填写 API 密钥：
   - **转写** —— 阿里巴巴百炼 API Key
   - **分析** —— 任意 OpenAI 兼容的 Base URL + API Key + 模型名
4. 点击侧边栏图标或通过命令面板开始新会议

### 手动安装

如果你想手动安装：

```bash
git clone https://github.com/Eonvariel/Voxora.git
cd obsidian-voxora
npm install
npm run build
```

然后将 `main.js`、`manifest.json` 和 `styles.css` 复制到 `<你的仓库>/.obsidian/plugins/voxora/` 目录中。

### 使用要求

- Obsidian ≥ 1.5.0
- Obsidian 桌面版（Electron），不支持移动端
- 转写功能需要阿里巴巴百炼 API Key
- 分析功能需要 OpenAI 兼容的 API 接口

---

## Development / 开发

```bash
npm install
npm run dev      # watch mode / 监听模式
npm run build    # production build / 生产构建
npm test         # run tests / 运行测试
```

## License / 许可证

MIT © 闫世杰

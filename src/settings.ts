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
  meetingFolder: string;
  enableAnalysis: boolean;
  defaultInputDeviceId: string;
  saveAudio: boolean;
  autoAnalyze: boolean;
  transcription: AlibabaBailianSettings;
  analysis: OpenAICompatibleSettings;
}

export type VoxoraSettingsInput = Partial<
  Omit<VoxoraSettings, "transcription" | "analysis">
> & {
  notesFolder?: string;
  recordingsFolder?: string;
  analysisFolder?: string;
  transcription?: Partial<AlibabaBailianSettings>;
  analysis?: Partial<OpenAICompatibleSettings>;
};

export const DEFAULT_SETTINGS: VoxoraSettings = {
  meetingFolder: "Meetings",
  enableAnalysis: true,
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

export function normalizeSettings(input: VoxoraSettingsInput): VoxoraSettings {
  const {
    notesFolder,
    recordingsFolder: _recordingsFolder,
    analysisFolder: _analysisFolder,
    ...currentInput
  } = input;
  const meetingFolder =
    currentInput.meetingFolder?.trim() ||
    notesFolder?.trim() ||
    DEFAULT_SETTINGS.meetingFolder;

  return {
    ...DEFAULT_SETTINGS,
    ...currentInput,
    meetingFolder,
    enableAnalysis: currentInput.enableAnalysis ?? DEFAULT_SETTINGS.enableAnalysis,
    saveAudio: true,
    autoAnalyze: true,
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

export function getMeetingsRootFolder(settings: VoxoraSettings): string {
  return settings.meetingFolder;
}

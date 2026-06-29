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

import type { MeetingSession, RecordingStatus } from "./domain";

export interface RecordingControllerDependencies {
  createSession(input: { title?: string }): Promise<MeetingSession>;
  startAudio(session: MeetingSession): Promise<void>;
  pauseAudio(session: MeetingSession): Promise<void>;
  resumeAudio(session: MeetingSession): Promise<void>;
  stopAudio(session: MeetingSession): Promise<{ durationSeconds: number }>;
  startTranscription(session: MeetingSession): Promise<void>;
  stopTranscription(session: MeetingSession): Promise<void>;
  analyze(session: MeetingSession, recording: { durationSeconds: number }): Promise<void>;
  markInterrupted(session: MeetingSession, error: Error): Promise<void>;
}

export class RecordingController {
  private status: RecordingStatus = "idle";
  private session: MeetingSession | undefined;
  private operationId = 0;

  constructor(private readonly dependencies: RecordingControllerDependencies) {}

  getStatus(): RecordingStatus {
    return this.status;
  }

  getSession(): MeetingSession | undefined {
    return this.session;
  }

  async start(input: { title?: string }): Promise<MeetingSession> {
    if (this.isActive()) {
      throw new Error("A recording is already active");
    }

    const operationId = this.nextOperation();
    this.session = undefined;
    this.setStatus("starting");

    try {
      const session = await this.dependencies.createSession(input);
      this.assertCurrentOperation(operationId);
      this.session = session;
      this.setStatus("starting");

      await this.dependencies.startAudio(session);
      this.assertCurrentOperation(operationId);
      try {
        await this.dependencies.startTranscription(session);
      } catch (error) {
        if (operationId === this.operationId) {
          await this.stopAudioForCleanup(session);
          this.assertCurrentOperation(operationId);
        }

        throw error;
      }
      this.assertCurrentOperation(operationId);

      this.setStatus("recording");
      return session;
    } catch (error) {
      this.failCurrentOperation(operationId);
      throw error;
    }
  }

  async pause(): Promise<void> {
    const session = this.requireSession("recording", "pause");
    const operationId = this.nextOperation();

    try {
      await this.dependencies.pauseAudio(session);
      this.assertCurrentOperation(operationId);
      this.setStatus("paused");
    } catch (error) {
      this.failCurrentOperation(operationId);
      throw error;
    }
  }

  async resume(): Promise<void> {
    const session = this.requireSession("paused", "resume");
    const operationId = this.nextOperation();

    try {
      await this.dependencies.resumeAudio(session);
      this.assertCurrentOperation(operationId);
      this.setStatus("recording");
    } catch (error) {
      this.failCurrentOperation(operationId);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const session = this.requireSession(["recording", "paused"], "stop");
    const operationId = this.nextOperation();

    try {
      this.setStatus("stopping");
      let stopTranscriptionError: unknown;
      let stopTranscriptionFailed = false;
      try {
        await this.dependencies.stopTranscription(session);
      } catch (error) {
        stopTranscriptionFailed = true;
        stopTranscriptionError = error;
      }
      this.assertCurrentOperation(operationId);
      if (stopTranscriptionFailed) {
        await this.stopAudioForCleanup(session);
        this.assertCurrentOperation(operationId);
        throw stopTranscriptionError;
      }

      const recording = await this.dependencies.stopAudio(session);
      this.assertCurrentOperation(operationId);

      this.setStatus("analyzing");
      await this.dependencies.analyze(session, recording);
      this.assertCurrentOperation(operationId);

      this.setStatus("completed");
    } catch (error) {
      this.failCurrentOperation(operationId);
      throw error;
    }
  }

  async interrupt(error: Error): Promise<void> {
    if (this.session === undefined && this.isActive()) {
      this.nextOperation();
      this.setStatus("failed");
      return;
    }

    if (this.session === undefined || !this.isActive()) {
      return;
    }

    this.nextOperation();
    try {
      await this.dependencies.markInterrupted(this.session, error);
      this.setStatus("interrupted");
    } catch (markInterruptedError) {
      this.setStatus("failed");
      throw markInterruptedError;
    }
  }

  private requireSession(expected: RecordingStatus | RecordingStatus[], action: string): MeetingSession {
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (this.session === undefined || !expectedStatuses.includes(this.status)) {
      throw new Error(`Cannot ${action} recording while ${this.status}`);
    }

    return this.session;
  }

  private setStatus(status: RecordingStatus): void {
    this.status = status;
    if (this.session !== undefined) {
      this.session.status = status;
    }
  }

  private isActive(): boolean {
    return ["starting", "recording", "paused", "stopping", "analyzing"].includes(this.status);
  }

  private nextOperation(): number {
    this.operationId += 1;
    return this.operationId;
  }

  private assertCurrentOperation(operationId: number): void {
    if (operationId !== this.operationId) {
      if (this.status === "interrupted") {
        throw new Error("Recording was interrupted");
      }

      throw new Error("Recording operation was superseded");
    }

    if (this.status === "interrupted") {
      throw new Error("Recording was interrupted");
    }

    if (this.status === "failed") {
      throw new Error("Recording failed");
    }
  }

  private failCurrentOperation(operationId: number): void {
    if (this.status === "interrupted") {
      return;
    }

    if (operationId === this.operationId) {
      this.setStatus("failed");
    }
  }

  private async stopAudioForCleanup(session: MeetingSession): Promise<void> {
    try {
      await this.dependencies.stopAudio(session);
    } catch {
      // Preserve the original failure while still giving audio a chance to flush.
    }
  }
}

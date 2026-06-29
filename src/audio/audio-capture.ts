import { mergeBlobs, resampleFloatToInt16Pcm } from "./pcm";

export interface AudioCaptureOptions {
  deviceId: string;
  mimeType: string;
  pcmSampleRate?: number;
}

export interface AudioCaptureResult {
  audioBlob: Blob;
  durationSeconds: number;
}

type PcmFrameListener = (frame: Int16Array) => void;

interface AudioCaptureDependencies {
  audioContextFactory: () => AudioContext;
  isTypeSupported: (mimeType: string) => boolean;
  mediaDevices: Pick<MediaDevices, "getUserMedia">;
  mediaRecorderFactory: (
    stream: MediaStream,
    options: MediaRecorderOptions,
  ) => MediaRecorder;
}

function createDefaultDependencies(): AudioCaptureDependencies {
  return {
    audioContextFactory: () => new AudioContext(),
    isTypeSupported: (mimeType) =>
      typeof MediaRecorder.isTypeSupported !== "function" ||
      MediaRecorder.isTypeSupported(mimeType),
    mediaDevices: navigator.mediaDevices,
    mediaRecorderFactory: (stream, options) => new MediaRecorder(stream, options),
  };
}

export class AudioCapture {
  private readonly listeners = new Set<PcmFrameListener>();
  private audioContext: AudioContext | undefined;
  private chunks: Blob[] = [];
  private readonly dependencies: AudioCaptureDependencies;
  private outputMimeType = "";
  private pausedAtMs: number | undefined;
  private pausedDurationMs = 0;
  private processor: ScriptProcessorNode | undefined;
  private recorder: MediaRecorder | undefined;
  private silentOutput: GainNode | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private startedAtMs: number | undefined;
  private stream: MediaStream | undefined;

  constructor(dependencies: AudioCaptureDependencies = createDefaultDependencies()) {
    this.dependencies = dependencies;
  }

  onPcmFrame(listener: PcmFrameListener): void {
    this.listeners.add(listener);
  }

  async start(options: AudioCaptureOptions): Promise<void> {
    if (this.stream) {
      throw new Error("Audio capture has already started.");
    }

    this.chunks = [];
    this.outputMimeType = "";
    this.pausedAtMs = undefined;
    this.pausedDurationMs = 0;
    this.startedAtMs = Date.now();

    const audioConstraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    };

    if (options.deviceId !== "") {
      audioConstraints.deviceId = { exact: options.deviceId };
    }

    try {
      const stream = await this.dependencies.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      this.stream = stream;
      this.audioContext = this.dependencies.audioContextFactory();
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.silentOutput = this.audioContext.createGain();
      this.silentOutput.gain.value = 0;

      const sourceSampleRate = this.audioContext.sampleRate;
      const targetSampleRate = options.pcmSampleRate ?? sourceSampleRate;

      this.processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        const frame = resampleFloatToInt16Pcm(
          samples,
          sourceSampleRate,
          targetSampleRate,
        );
        for (const listener of this.listeners) {
          listener(frame);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.silentOutput);
      this.silentOutput.connect(this.audioContext.destination);

      this.recorder = this.dependencies.mediaRecorderFactory(
        stream,
        this.getRecorderOptions(options.mimeType),
      );
      this.outputMimeType = this.recorder.mimeType || options.mimeType;
      this.recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      });
      this.recorder.start();
    } catch (error) {
      await this.releaseResourcesAfterFailure();
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.pausedAtMs !== undefined) {
      return;
    }

    this.pausedAtMs = Date.now();

    if (this.recorder?.state === "recording") {
      this.recorder.pause();
    }

    if (this.audioContext?.state === "running") {
      await this.audioContext.suspend();
    }
  }

  async resume(): Promise<void> {
    if (this.pausedAtMs === undefined) {
      return;
    }

    this.pausedDurationMs += Date.now() - this.pausedAtMs;
    this.pausedAtMs = undefined;

    if (this.recorder?.state === "paused") {
      this.recorder.resume();
    }

    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async stop(): Promise<AudioCaptureResult> {
    const durationSeconds = this.calculateDurationSeconds(Date.now());

    let stopError: unknown;
    let didStopFail = false;
    try {
      await this.stopRecorder();
    } catch (error) {
      stopError = error;
      didStopFail = true;
    }

    const audioBlob = mergeBlobs([...this.chunks], this.outputMimeType);
    if (didStopFail) {
      await this.releaseResourcesAfterFailure();
      throw stopError;
    }

    await this.releaseResources();
    return {
      audioBlob,
      durationSeconds,
    };
  }

  private calculateDurationSeconds(stoppedAtMs: number): number {
    if (this.startedAtMs === undefined) {
      return 0;
    }

    const activePauseMs =
      this.pausedAtMs === undefined ? 0 : stoppedAtMs - this.pausedAtMs;
    const durationMs =
      stoppedAtMs - this.startedAtMs - this.pausedDurationMs - activePauseMs;

    return Math.floor(Math.max(0, durationMs / 1000));
  }

  private getRecorderOptions(mimeType: string): MediaRecorderOptions {
    if (!this.dependencies.isTypeSupported(mimeType)) {
      return {};
    }

    return { mimeType };
  }

  private async stopRecorder(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        recorder.removeEventListener("stop", handleStop);
        recorder.removeEventListener("error", handleError);
      };
      const handleStop = (): void => {
        cleanup();
        resolve();
      };
      const handleError = (event: Event): void => {
        cleanup();
        reject(
          event instanceof ErrorEvent
            ? event.error
            : new Error("MediaRecorder stopped with an error."),
        );
      };

      recorder.addEventListener("stop", handleStop);
      recorder.addEventListener("error", handleError);
      recorder.stop();
    });
  }

  private async releaseResources(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentOutput?.disconnect();

    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }

    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }

    this.audioContext = undefined;
    this.chunks = [];
    this.outputMimeType = "";
    this.pausedAtMs = undefined;
    this.pausedDurationMs = 0;
    this.processor = undefined;
    this.recorder = undefined;
    this.silentOutput = undefined;
    this.source = undefined;
    this.startedAtMs = undefined;
    this.stream = undefined;
  }

  private async releaseResourcesAfterFailure(): Promise<void> {
    try {
      await this.releaseResources();
    } catch {
      // Preserve the original start/stop failure while still attempting cleanup.
    }
  }
}

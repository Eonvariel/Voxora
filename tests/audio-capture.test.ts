import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCapture } from "../src/audio/audio-capture";

type AudioCaptureFactory = new (dependencies: {
  audioContextFactory: () => FakeAudioContext;
  mediaDevices: {
    getUserMedia: ReturnType<typeof vi.fn>;
  };
  mediaRecorderFactory: (
    stream: FakeMediaStream,
    options: MediaRecorderOptions,
  ) => FakeMediaRecorder;
  isTypeSupported: (mimeType: string) => boolean;
}) => AudioCapture;

type RecorderEventListener = (event: Event) => void;

class FakeMediaStream {
  readonly track = { stop: vi.fn() };

  getTracks(): Array<{ stop: ReturnType<typeof vi.fn> }> {
    return [this.track];
  }
}

class FakeAudioNode {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = { value: 1 };
}

class FakeScriptProcessorNode extends FakeAudioNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
}

class FakeAudioContext {
  readonly close = vi.fn(async () => {
    this.state = "closed";
  });
  readonly createGain = vi.fn(() => new FakeGainNode());
  readonly createMediaStreamSource = vi.fn(() => new FakeAudioNode());
  readonly createScriptProcessor = vi.fn(() => this.processor);
  readonly destination = new FakeAudioNode();
  readonly processor = new FakeScriptProcessorNode();
  readonly resume = vi.fn(async () => {
    this.state = "running";
  });
  readonly sampleRate = 48000;
  readonly suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  state: AudioContextState = "running";
}

class FakeMediaRecorder {
  readonly addEventListener = vi.fn(
    (type: string, listener: RecorderEventListener) => {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    },
  );
  readonly listeners = new Map<string, RecorderEventListener[]>();
  readonly mimeType = "audio/webm";
  readonly pause = vi.fn(() => {
    this.state = "paused";
  });
  readonly removeEventListener = vi.fn(
    (type: string, listener: RecorderEventListener) => {
      const listeners = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        listeners.filter((candidate) => candidate !== listener),
      );
    },
  );
  readonly resume = vi.fn(() => {
    this.state = "recording";
  });
  readonly start = vi.fn(() => {
    this.state = "recording";
  });
  readonly stop = vi.fn(() => {
    this.state = "inactive";
    this.dispatch("stop", new Event("stop"));
  });
  state: RecordingState = "inactive";

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createCaptureHarness() {
  const stream = new FakeMediaStream();
  const audioContext = new FakeAudioContext();
  const recorder = new FakeMediaRecorder();
  const dependencies = {
    audioContextFactory: vi.fn(() => audioContext),
    mediaDevices: {
      getUserMedia: vi.fn(async () => stream),
    },
    mediaRecorderFactory: vi.fn(() => recorder),
    isTypeSupported: vi.fn(() => true),
  };
  const Capture = AudioCapture as unknown as AudioCaptureFactory;

  return {
    audioContext,
    capture: new Capture(dependencies),
    dependencies,
    recorder,
    stream,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AudioCapture", () => {
  it("releases acquired resources and can retry when start fails after getUserMedia", async () => {
    const { audioContext, capture, dependencies, recorder, stream } =
      createCaptureHarness();
    const startFailure = new Error("recorder start failed");
    recorder.start.mockImplementationOnce(() => {
      throw startFailure;
    });

    await expect(
      capture.start({ deviceId: "", mimeType: "audio/webm" }),
    ).rejects.toBe(startFailure);

    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(audioContext.close).toHaveBeenCalledTimes(1);

    await expect(
      capture.start({ deviceId: "", mimeType: "audio/webm" }),
    ).resolves.toBeUndefined();
    expect(dependencies.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("releases resources and rethrows the original error when stop fails", async () => {
    const { audioContext, capture, recorder, stream } = createCaptureHarness();
    const stopFailure = new Error("recorder stop failed");

    await capture.start({ deviceId: "", mimeType: "audio/webm" });
    recorder.stop.mockImplementationOnce(() => {
      throw stopFailure;
    });

    await expect(capture.stop()).rejects.toBe(stopFailure);

    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(audioContext.close).toHaveBeenCalledTimes(1);
  });

  it("returns floored duration seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { capture } = createCaptureHarness();

    await capture.start({ deviceId: "", mimeType: "audio/webm" });
    vi.setSystemTime(2_999);

    await expect(capture.stop()).resolves.toMatchObject({
      durationSeconds: 1,
    });
  });

  it("emits PCM frames resampled to the requested transcription sample rate", async () => {
    const { audioContext, capture } = createCaptureHarness();
    const frames: Int16Array[] = [];
    capture.onPcmFrame((frame) => frames.push(frame));

    await capture.start({
      deviceId: "",
      mimeType: "audio/webm",
      pcmSampleRate: 16000,
    });

    audioContext.processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () =>
          new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.5]),
      },
    } as unknown as AudioProcessingEvent);

    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0])).toEqual([0, 24575]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { AlibabaBailianTranscriptionProvider } from "../src/providers/alibaba-bailian-transcription-provider";
import type { AlibabaBailianSettings } from "../src/settings";

type Listener = (...args: unknown[]) => void;

const socketState = vi.hoisted(() => {
  class FakeSocket {
    static readonly OPEN = 1;

    readonly sent: Array<string | Buffer> = [];
    readyState = 0;
    private readonly listeners = new Map<string, Listener[]>();
    private readonly onceListeners = new Map<string, Listener[]>();

    constructor(
      readonly endpoint: string,
      readonly options: { headers?: Record<string, string> }
    ) {
      socketState.lastSocket = this;
    }

    on(event: string, listener: Listener): this {
      this.addListener(this.listeners, event, listener);
      return this;
    }

    once(event: string, listener: Listener): this {
      this.addListener(this.onceListeners, event, listener);
      return this;
    }

    off(event: string, listener: Listener): this {
      this.removeListener(this.listeners, event, listener);
      this.removeListener(this.onceListeners, event, listener);
      return this;
    }

    send(data: string | Buffer): void {
      this.sent.push(data);
    }

    close(): void {
      this.readyState = 3;
      this.emit("close");
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }

      const onceListeners = this.onceListeners.get(event) ?? [];
      this.onceListeners.delete(event);
      for (const listener of onceListeners) {
        listener(...args);
      }
    }

    open(): void {
      this.readyState = FakeSocket.OPEN;
      this.emit("open");
    }

    message(message: unknown): void {
      this.emit("message", Buffer.from(JSON.stringify(message)));
    }

    private addListener(
      listeners: Map<string, Listener[]>,
      event: string,
      listener: Listener
    ): void {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }

    private removeListener(
      listeners: Map<string, Listener[]>,
      event: string,
      listener: Listener
    ): void {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((candidate) => candidate !== listener)
      );
    }
  }

  return {
    FakeSocket,
    lastSocket: undefined as InstanceType<typeof FakeSocket> | undefined
  };
});

vi.mock("ws", () => ({
  default: socketState.FakeSocket
}));

const settings: AlibabaBailianSettings = {
  apiKey: "test-key",
  model: "paraformer-realtime-v2",
  sampleRate: 16000,
  endpoint: "wss://example.test/asr"
};

async function openAndStart(connectPromise: Promise<void>): Promise<void> {
  socketState.lastSocket?.open();
  socketState.lastSocket?.message({
    header: { event: "task-started" },
    payload: {}
  });
  await connectPromise;
}

describe("AlibabaBailianTranscriptionProvider", () => {
  it("rejects connect errors without notifying runtime error listeners", async () => {
    const provider = new AlibabaBailianTranscriptionProvider(settings);
    const onError = vi.fn();
    provider.onError(onError);

    const connectPromise = provider.connect();
    socketState.lastSocket?.emit("error", new Error("connection failed"));

    await expect(connectPromise).rejects.toThrow("connection failed");
    expect(onError).not.toHaveBeenCalled();
  });

  it("notifies runtime error listeners after connect opens", async () => {
    const provider = new AlibabaBailianTranscriptionProvider(settings);
    const onError = vi.fn();
    provider.onError(onError);

    const connectPromise = provider.connect();
    await openAndStart(connectPromise);

    socketState.lastSocket?.emit("error", new Error("runtime failed"));

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(new Error("runtime failed"));
  });

  it("waits for task-finished before resolving finish", async () => {
    const provider = new AlibabaBailianTranscriptionProvider(settings);
    const connectPromise = provider.connect();
    await openAndStart(connectPromise);

    let resolved = false;
    const finishPromise = provider.finish().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(socketState.lastSocket?.sent.at(-1)).toContain(
      '"action":"finish-task"'
    );

    socketState.lastSocket?.message({
      header: { event: "task-finished" },
      payload: {}
    });
    await finishPromise;

    expect(resolved).toBe(true);
  });

  it("rejects pending finish when Bailian reports task failure", async () => {
    const provider = new AlibabaBailianTranscriptionProvider(settings);
    const connectPromise = provider.connect();
    await openAndStart(connectPromise);

    const finishPromise = provider.finish();
    socketState.lastSocket?.message({
      header: {
        event: "task-failed",
        error_message: "finish failed"
      },
      payload: {}
    });

    await expect(finishPromise).rejects.toThrow("finish failed");
  });

  it("waits for task-started before resolving connect and sending audio", async () => {
    const provider = new AlibabaBailianTranscriptionProvider(settings);
    let connected = false;

    const connectPromise = provider.connect().then(() => {
      connected = true;
    });
    socketState.lastSocket?.open();

    await Promise.resolve();
    expect(connected).toBe(false);

    provider.sendPcmFrame(new Int16Array([1, 2, 3]));
    expect(socketState.lastSocket?.sent).toHaveLength(1);

    socketState.lastSocket?.message({
      header: { event: "task-started" },
      payload: {}
    });
    await connectPromise;

    provider.sendPcmFrame(new Int16Array([1, 2, 3]));
    expect(socketState.lastSocket?.sent).toHaveLength(2);
    expect(Buffer.isBuffer(socketState.lastSocket?.sent.at(-1))).toBe(true);
  });
});

import WebSocket, { type RawData } from "ws";
import type { TranscriptSegment, TranscriptionProvider } from "../domain";
import type { AlibabaBailianSettings } from "../settings";
import {
  buildFinishTaskMessage,
  buildRunTaskMessage,
  parseBailianMessage
} from "./alibaba-bailian-protocol";

const { v4: uuidv4 } = require("uuid") as { v4: () => string };

type TemporaryResultListener = (text: string) => void;
type FinalSegmentListener = (segment: TranscriptSegment) => void;
type ErrorListener = (error: Error) => void;
type IdGenerator = () => string;

interface BailianSocket {
  readyState: number;
  on(event: "message", listener: (data: RawData) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: () => void): this;
  once(event: "open", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  off(event: "open", listener: () => void): this;
  off(event: "error", listener: (error: Error) => void): this;
  send(data: string | Buffer): void;
  close(): void;
}

interface AlibabaBailianProviderDependencies {
  webSocketFactory?: (
    endpoint: string,
    options: { headers: { Authorization: string } }
  ) => BailianSocket;
  idGenerator?: IdGenerator;
}

interface PendingFinish {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class AlibabaBailianTranscriptionProvider
  implements TranscriptionProvider
{
  private socket?: BailianSocket;
  private taskId?: string;
  private taskStarted = false;
  private pendingStart?: PendingFinish;
  private pendingFinish?: PendingFinish;
  private readonly temporaryResultListeners: TemporaryResultListener[] = [];
  private readonly finalSegmentListeners: FinalSegmentListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  private readonly webSocketFactory: (
    endpoint: string,
    options: { headers: { Authorization: string } }
  ) => BailianSocket;
  private readonly idGenerator: IdGenerator;

  constructor(
    private readonly settings: AlibabaBailianSettings,
    dependencies: AlibabaBailianProviderDependencies = {}
  ) {
    this.webSocketFactory =
      dependencies.webSocketFactory ??
      ((endpoint, options) => new WebSocket(endpoint, options));
    this.idGenerator = dependencies.idGenerator ?? uuidv4;
  }

  async connect(): Promise<void> {
    const apiKey = this.settings.apiKey.trim();

    if (!apiKey) {
      throw new Error("Alibaba Bailian transcription API key is required");
    }

    const taskId = this.idGenerator();
    this.taskId = taskId;
    this.taskStarted = false;
    this.socket = this.webSocketFactory(this.settings.endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    this.socket.on("message", (data) => this.handleMessage(data));
    this.socket.on("close", () => {
      const error = new Error(
        "Alibaba Bailian transcription socket closed before finish"
      );
      this.rejectPendingStart(error);
      this.rejectPendingFinish(error);
    });

    await new Promise<void>((resolve, reject) => {
      const socket = this.socket;

      if (!socket) {
        reject(new Error("Alibaba Bailian transcription socket was not created"));
        return;
      }

      const handleOpen = () => {
        socket.off("error", handleConnectionError);
        socket.on("error", (error) => {
          this.rejectPendingStart(error);
          this.rejectPendingFinish(error);
          this.emitError(error);
        });
        this.pendingStart = this.createPendingFinish();
        socket.send(
          JSON.stringify(
            buildRunTaskMessage({
              taskId,
              model: this.settings.model,
              sampleRate: this.settings.sampleRate
            })
          )
        );
        resolve();
      };
      const handleConnectionError = (error: Error) => {
        socket.off("open", handleOpen);
        reject(error);
      };

      socket.once("open", handleOpen);
      socket.once("error", handleConnectionError);
    });

    await this.pendingStart?.promise;
  }

  sendPcmFrame(frame: Int16Array): void {
    const socket = this.openSocket();

    if (!socket || !this.taskStarted) {
      return;
    }

    socket.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
  }

  async finish(): Promise<void> {
    const socket = this.openSocket();

    if (!socket || !this.taskId) {
      return;
    }

    if (this.pendingFinish) {
      return this.pendingFinish.promise;
    }

    socket.send(JSON.stringify(buildFinishTaskMessage(this.taskId)));
    this.pendingFinish = this.createPendingFinish();

    return this.pendingFinish.promise;
  }

  close(): void {
    const error = new Error(
      "Alibaba Bailian transcription socket closed before finish"
    );
    this.rejectPendingStart(error);
    this.rejectPendingFinish(error);
    this.socket?.close();
    this.socket = undefined;
    this.taskStarted = false;
  }

  onTemporaryResult(listener: TemporaryResultListener): void {
    this.temporaryResultListeners.push(listener);
  }

  onFinalSegment(listener: FinalSegmentListener): void {
    this.finalSegmentListeners.push(listener);
  }

  onError(listener: ErrorListener): void {
    this.errorListeners.push(listener);
  }

  private handleMessage(data: RawData): void {
    const parsed = parseBailianMessage(data.toString());

    if (parsed.type === "started") {
      this.taskStarted = true;
      this.resolvePendingStart();
      return;
    }

    if (parsed.type === "temporary") {
      this.temporaryResultListeners.forEach((listener) => listener(parsed.text));
      return;
    }

    if (parsed.type === "final") {
      const segment: TranscriptSegment = {
        id: this.idGenerator(),
        startSeconds: parsed.startSeconds,
        text: parsed.text,
        final: true
      };

      this.finalSegmentListeners.forEach((listener) => listener(segment));
      return;
    }

    if (parsed.type === "error") {
      if (this.pendingStart) {
        this.rejectPendingStart(parsed.error);
        return;
      }

      if (this.pendingFinish) {
        this.rejectPendingFinish(parsed.error);
        return;
      }

      this.emitError(parsed.error);
      return;
    }

    if (parsed.type === "finished") {
      this.resolvePendingFinish();
    }
  }

  private openSocket(): BailianSocket | undefined {
    return this.socket?.readyState === WebSocket.OPEN ? this.socket : undefined;
  }

  private emitError(error: Error): void {
    this.errorListeners.forEach((listener) => listener(error));
  }

  private createPendingFinish(): PendingFinish {
    let resolveFinish: (() => void) | undefined;
    let rejectFinish: ((error: Error) => void) | undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveFinish = resolve;
      rejectFinish = reject;
    });

    if (!resolveFinish || !rejectFinish) {
      throw new Error("Alibaba Bailian finish promise was not initialized");
    }

    return {
      promise,
      resolve: resolveFinish,
      reject: rejectFinish
    };
  }

  private resolvePendingFinish(): void {
    const pendingFinish = this.pendingFinish;

    if (!pendingFinish) {
      return;
    }

    this.pendingFinish = undefined;
    pendingFinish.resolve();
  }

  private resolvePendingStart(): void {
    const pendingStart = this.pendingStart;

    if (!pendingStart) {
      return;
    }

    this.pendingStart = undefined;
    pendingStart.resolve();
  }

  private rejectPendingFinish(error: Error): void {
    const pendingFinish = this.pendingFinish;

    if (!pendingFinish) {
      return;
    }

    this.pendingFinish = undefined;
    pendingFinish.reject(error);
  }

  private rejectPendingStart(error: Error): void {
    const pendingStart = this.pendingStart;

    if (!pendingStart) {
      return;
    }

    this.pendingStart = undefined;
    pendingStart.reject(error);
  }
}

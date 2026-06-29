export interface BailianRunTaskInput {
  taskId: string;
  model: string;
  sampleRate: number;
}

export type BailianParsedMessage =
  | { type: "started" }
  | { type: "temporary"; text: string }
  | { type: "final"; text: string; startSeconds: number }
  | { type: "finished" }
  | { type: "error"; error: Error }
  | { type: "ignored" };

interface BailianMessageRecord {
  header?: {
    event?: unknown;
    action?: unknown;
    error_message?: unknown;
    message?: unknown;
  };
  payload?: {
    output?: {
      sentence?: {
        text?: unknown;
        begin_time?: unknown;
        sentence_end?: unknown;
      };
    };
    message?: unknown;
  };
}

export function buildRunTaskMessage(input: BailianRunTaskInput) {
  return {
    header: {
      action: "run-task",
      task_id: input.taskId,
      streaming: "duplex"
    },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: input.model,
      input: {},
      parameters: {
        format: "pcm",
        sample_rate: input.sampleRate
      }
    }
  };
}

export function buildFinishTaskMessage(taskId: string) {
  return {
    header: {
      action: "finish-task",
      task_id: taskId,
      streaming: "duplex"
    },
    payload: {
      input: {}
    }
  };
}

export function parseBailianMessage(raw: string): BailianParsedMessage {
  let message: unknown;

  try {
    message = JSON.parse(raw);
  } catch {
    return { type: "ignored" };
  }

  if (!isObjectRecord(message)) {
    return { type: "ignored" };
  }

  const record = message as BailianMessageRecord;
  const event = record.header?.event;

  if (event === "task-failed" || event === "error") {
    return {
      type: "error",
      error: new Error(readErrorMessage(record))
    };
  }

  if (event === "task-finished") {
    return { type: "finished" };
  }

  if (event === "task-started") {
    return { type: "started" };
  }

  if (event !== "result-generated") {
    return { type: "ignored" };
  }

  const sentence = record.payload?.output?.sentence;

  if (!sentence || typeof sentence.text !== "string" || !sentence.text) {
    return { type: "ignored" };
  }

  if (sentence.sentence_end === true) {
    return {
      type: "final",
      text: sentence.text,
      startSeconds: readStartSeconds(sentence.begin_time)
    };
  }

  return {
    type: "temporary",
    text: sentence.text
  };
}

function readStartSeconds(beginTime: unknown): number {
  if (typeof beginTime !== "number" || !Number.isFinite(beginTime)) {
    return 0;
  }

  return Math.max(0, Math.floor(beginTime / 1000));
}

function readErrorMessage(message: BailianMessageRecord): string {
  const candidates = [
    message.header?.error_message,
    message.header?.message,
    message.payload?.message
  ];
  const errorMessage = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0
  );

  return errorMessage ?? "Alibaba Bailian transcription failed";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

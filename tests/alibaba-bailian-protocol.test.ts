import { describe, expect, it } from "vitest";
import {
  buildFinishTaskMessage,
  buildRunTaskMessage,
  parseBailianMessage
} from "../src/providers/alibaba-bailian-protocol";

describe("Alibaba Bailian protocol helpers", () => {
  it("builds a run-task message for real-time ASR", () => {
    const message = buildRunTaskMessage({
      taskId: "task-1",
      model: "paraformer-realtime-v2",
      sampleRate: 16000
    });

    expect(message.header.action).toBe("run-task");
    expect(message.header.task_id).toBe("task-1");
    expect(message.header.streaming).toBe("duplex");
    expect(message.payload.task_group).toBe("audio");
    expect(message.payload.task).toBe("asr");
    expect(message.payload.function).toBe("recognition");
    expect(message.payload.model).toBe("paraformer-realtime-v2");
    expect(message.payload.input).toEqual({});
    expect(message.payload.parameters.format).toBe("pcm");
    expect(message.payload.parameters.sample_rate).toBe(16000);
  });

  it("builds a finish-task message", () => {
    expect(buildFinishTaskMessage("task-1")).toEqual({
      header: {
        action: "finish-task",
        task_id: "task-1",
        streaming: "duplex"
      },
      payload: {
        input: {}
      }
    });
  });

  it("parses temporary and final text events", () => {
    const temporary = parseBailianMessage(
      JSON.stringify({
        header: { event: "result-generated" },
        payload: {
          output: { sentence: { text: "临时文本", sentence_end: false } }
        }
      })
    );
    const final = parseBailianMessage(
      JSON.stringify({
        header: { event: "result-generated" },
        payload: {
          output: {
            sentence: {
              text: "最终文本",
              begin_time: 1200,
              sentence_end: true
            }
          }
        }
      })
    );

    expect(temporary).toEqual({ type: "temporary", text: "临时文本" });
    expect(final).toEqual({ type: "final", text: "最终文本", startSeconds: 1 });
  });

  it("parses task-started events", () => {
    expect(
      parseBailianMessage(
        JSON.stringify({
          header: { event: "task-started" },
          payload: {}
        })
      )
    ).toEqual({ type: "started" });
  });

  it("clamps invalid final begin times to zero", () => {
    const negative = parseBailianMessage(
      JSON.stringify({
        header: { event: "result-generated" },
        payload: {
          output: {
            sentence: {
              text: "负数时间",
              begin_time: -1200,
              sentence_end: true
            }
          }
        }
      })
    );
    const notFinite = parseBailianMessage(
      JSON.stringify({
        header: { event: "result-generated" },
        payload: {
          output: {
            sentence: {
              text: "非有限时间",
              begin_time: Number.POSITIVE_INFINITY,
              sentence_end: true
            }
          }
        }
      })
    );
    const notANumber = parseBailianMessage(
      JSON.stringify({
        header: { event: "result-generated" },
        payload: {
          output: {
            sentence: {
              text: "NaN时间",
              begin_time: Number.NaN,
              sentence_end: true
            }
          }
        }
      })
    );

    expect(negative).toEqual({
      type: "final",
      text: "负数时间",
      startSeconds: 0
    });
    expect(notFinite).toEqual({
      type: "final",
      text: "非有限时间",
      startSeconds: 0
    });
    expect(notANumber).toEqual({
      type: "final",
      text: "NaN时间",
      startSeconds: 0
    });
  });
});

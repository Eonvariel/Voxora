import { describe, expect, it, vi } from "vitest";
import { RecordingController, type RecordingControllerDependencies } from "../src/recording-controller";
import type { MeetingSession } from "../src/domain";

function makeSession(id = "session-1"): MeetingSession {
  return {
    id,
    title: "会议记录",
    notePath: `Meetings/${id}.md`,
    audioPath: `Attachments/${id}.webm`,
    startedAt: new Date("2026-06-28T07:30:00.000Z"),
    status: "recording"
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function makeController(overrides: Partial<RecordingControllerDependencies> = {}) {
  const session = makeSession();
  const dependencies: RecordingControllerDependencies = {
    createSession: vi.fn(async () => session),
    startAudio: vi.fn(async () => undefined),
    pauseAudio: vi.fn(async () => undefined),
    resumeAudio: vi.fn(async () => undefined),
    stopAudio: vi.fn(async () => ({ durationSeconds: 1800 })),
    startTranscription: vi.fn(async () => undefined),
    stopTranscription: vi.fn(async () => undefined),
    analyze: vi.fn(async () => undefined),
    markInterrupted: vi.fn(async () => undefined),
    ...overrides
  };

  return {
    controller: new RecordingController(dependencies),
    dependencies
  };
}

describe("RecordingController", () => {
  it("moves through start pause resume stop and analyze", async () => {
    const { controller } = makeController();

    await controller.start({ title: "设计评审" });
    expect(controller.getStatus()).toBe("recording");
    const session: MeetingSession | undefined = controller.getSession();
    expect(session?.status).toBe("recording");

    await controller.pause();
    expect(controller.getStatus()).toBe("paused");

    await controller.resume();
    expect(controller.getStatus()).toBe("recording");

    await controller.stop();
    expect(controller.getStatus()).toBe("completed");
  });

  it("rejects concurrent recordings", async () => {
    const { controller } = makeController();
    await controller.start({ title: "第一场" });

    await expect(controller.start({ title: "第二场" })).rejects.toThrow("A recording is already active");
  });

  it("marks the session as starting while audio start is in flight", async () => {
    const startAudio = deferred<void>();
    const { controller } = makeController({
      startAudio: vi.fn(async () => startAudio.promise)
    });

    const startPromise = controller.start({ title: "会议" });
    await vi.waitFor(() => expect(controller.getSession()).toBeDefined());

    expect(controller.getStatus()).toBe("starting");
    expect(controller.getSession()?.status).toBe("starting");

    startAudio.resolve(undefined);
    await startPromise;
  });

  it("marks active sessions as interrupted", async () => {
    const { controller } = makeController();
    await controller.start({ title: "会议" });
    await controller.interrupt(new Error("Obsidian unloaded"));

    expect(controller.getStatus()).toBe("interrupted");
  });

  it("enters failed after createSession fails and allows a later start", async () => {
    const nextSession = makeSession("session-2");
    const createSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("Vault write failed"))
      .mockResolvedValueOnce(nextSession);
    const { controller } = makeController({ createSession });

    await expect(controller.start({ title: "失败场" })).rejects.toThrow("Vault write failed");
    expect(controller.getStatus()).toBe("failed");

    await controller.start({ title: "恢复场" });
    expect(controller.getStatus()).toBe("recording");
    expect(controller.getSession()).toBe(nextSession);
  });

  it("cleans up audio when transcription start fails", async () => {
    const firstSession = makeSession("session-1");
    const secondSession = makeSession("session-2");
    const transcriptStartError = new Error("transcript start failed");
    const createSession = vi.fn().mockResolvedValueOnce(firstSession).mockResolvedValueOnce(secondSession);
    const startTranscription = vi.fn().mockRejectedValueOnce(transcriptStartError).mockResolvedValueOnce(undefined);
    const stopAudio = vi.fn(async () => ({ durationSeconds: 12 }));
    const { controller } = makeController({ createSession, startTranscription, stopAudio });

    await expect(controller.start({ title: "失败场" })).rejects.toBe(transcriptStartError);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(stopAudio).toHaveBeenCalledWith(firstSession);
    expect(controller.getStatus()).toBe("failed");

    await controller.start({ title: "恢复场" });
    expect(controller.getStatus()).toBe("recording");
    expect(controller.getSession()).toBe(secondSession);
  });

  it("preserves the transcription start error when audio cleanup also fails", async () => {
    const transcriptStartError = new Error("transcript start failed");
    const audioCleanupError = new Error("audio cleanup failed");
    const startTranscription = vi.fn(async () => Promise.reject(transcriptStartError));
    const stopAudio = vi.fn(async () => Promise.reject(audioCleanupError));
    const { controller } = makeController({ startTranscription, stopAudio });

    await expect(controller.start({ title: "失败场" })).rejects.toBe(transcriptStartError);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toBe("failed");
  });

  it("replaces the old session when starting after a completed stop", async () => {
    const firstSession = makeSession("session-1");
    const secondSession = makeSession("session-2");
    const createSession = vi.fn().mockResolvedValueOnce(firstSession).mockResolvedValueOnce(secondSession);
    const { controller } = makeController({ createSession });

    await controller.start({ title: "第一场" });
    await controller.stop();
    await controller.start({ title: "第二场" });

    expect(controller.getStatus()).toBe("recording");
    expect(controller.getSession()).toBe(secondSession);
    expect(firstSession.status).toBe("completed");
    expect(secondSession.status).toBe("recording");
  });

  it("stop still stops audio when stopping transcription fails", async () => {
    const transcriptStopError = new Error("transcript stop failed");
    const stopTranscription = vi.fn(async () => Promise.reject(transcriptStopError));
    const stopAudio = vi.fn(async () => ({ durationSeconds: 1800 }));
    const analyze = vi.fn(async () => undefined);
    const { controller } = makeController({ stopTranscription, stopAudio, analyze });

    await controller.start({ title: "会议" });
    const session = controller.getSession();

    await expect(controller.stop()).rejects.toBe(transcriptStopError);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(stopAudio).toHaveBeenCalledWith(session);
    expect(analyze).not.toHaveBeenCalled();
    expect(controller.getStatus()).toBe("failed");
    expect(session?.status).toBe("failed");
  });

  it("preserves the transcription stop error when audio cleanup also fails", async () => {
    const transcriptStopError = new Error("transcript stop failed");
    const audioCleanupError = new Error("audio cleanup failed");
    const stopTranscription = vi.fn(async () => Promise.reject(transcriptStopError));
    const stopAudio = vi.fn(async () => Promise.reject(audioCleanupError));
    const analyze = vi.fn(async () => undefined);
    const { controller } = makeController({ stopTranscription, stopAudio, analyze });

    await controller.start({ title: "会议" });

    await expect(controller.stop()).rejects.toBe(transcriptStopError);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(analyze).not.toHaveBeenCalled();
    expect(controller.getStatus()).toBe("failed");
  });

  it.each([
    ["stopTranscription", { stopTranscription: vi.fn(async () => Promise.reject(new Error("transcript stop failed"))) }],
    ["stopAudio", { stopAudio: vi.fn(async () => Promise.reject(new Error("audio stop failed"))) }],
    ["analyze", { analyze: vi.fn(async () => Promise.reject(new Error("analysis failed"))) }]
  ])("enters failed when %s fails during stop and allows a later start", async (_name, override) => {
    const firstSession = makeSession("session-1");
    const secondSession = makeSession("session-2");
    const createSession = vi.fn().mockResolvedValueOnce(firstSession).mockResolvedValueOnce(secondSession);
    const { controller } = makeController({ createSession, ...override });

    await controller.start({ title: "第一场" });
    await expect(controller.stop()).rejects.toThrow();
    expect(controller.getStatus()).toBe("failed");
    expect(firstSession.status).toBe("failed");

    await controller.start({ title: "恢复场" });
    expect(controller.getStatus()).toBe("recording");
    expect(controller.getSession()).toBe(secondSession);
  });

  it("keeps interrupted state when an in-flight start resolves later", async () => {
    const startAudio = deferred<void>();
    const { controller, dependencies } = makeController({
      startAudio: vi.fn(async () => startAudio.promise)
    });

    const startPromise = controller.start({ title: "会议" });
    await vi.waitFor(() => expect(controller.getSession()).toBeDefined());

    await controller.interrupt(new Error("Obsidian unloaded"));
    startAudio.resolve(undefined);

    await expect(startPromise).rejects.toThrow("Recording was interrupted");
    expect(controller.getStatus()).toBe("interrupted");
    expect(dependencies.startTranscription).not.toHaveBeenCalled();
  });

  it("keeps interrupted state when an in-flight pause resolves later", async () => {
    const pauseAudio = deferred<void>();
    const { controller, dependencies } = makeController({
      pauseAudio: vi.fn(async () => pauseAudio.promise)
    });

    await controller.start({ title: "会议" });
    const pausePromise = controller.pause();
    await vi.waitFor(() => expect(dependencies.pauseAudio).toHaveBeenCalled());

    await controller.interrupt(new Error("Obsidian unloaded"));
    pauseAudio.resolve(undefined);

    await expect(pausePromise).rejects.toThrow("Recording was interrupted");
    expect(controller.getStatus()).toBe("interrupted");
    expect(controller.getSession()?.status).toBe("interrupted");
  });

  it("keeps interrupted state when an in-flight resume resolves later", async () => {
    const resumeAudio = deferred<void>();
    const { controller, dependencies } = makeController({
      resumeAudio: vi.fn(async () => resumeAudio.promise)
    });

    await controller.start({ title: "会议" });
    await controller.pause();
    const resumePromise = controller.resume();
    await vi.waitFor(() => expect(dependencies.resumeAudio).toHaveBeenCalled());

    await controller.interrupt(new Error("Obsidian unloaded"));
    resumeAudio.resolve(undefined);

    await expect(resumePromise).rejects.toThrow("Recording was interrupted");
    expect(controller.getStatus()).toBe("interrupted");
    expect(controller.getSession()?.status).toBe("interrupted");
  });

  it("lets stop supersede an in-flight pause without ending paused", async () => {
    const pauseAudio = deferred<void>();
    const { controller, dependencies } = makeController({
      pauseAudio: vi.fn(async () => pauseAudio.promise)
    });

    await controller.start({ title: "会议" });
    const pausePromise = controller.pause();
    await vi.waitFor(() => expect(dependencies.pauseAudio).toHaveBeenCalled());

    const stopPromise = controller.stop();
    pauseAudio.resolve(undefined);

    await expect(pausePromise).rejects.toThrow("Recording operation was superseded");
    await expect(stopPromise).resolves.toBeUndefined();
    expect(controller.getStatus()).toBe("completed");
    expect(controller.getSession()?.status).toBe("completed");
  });

  it("lets stop supersede an in-flight resume without ending recording", async () => {
    const resumeAudio = deferred<void>();
    const { controller, dependencies } = makeController({
      resumeAudio: vi.fn(async () => resumeAudio.promise)
    });

    await controller.start({ title: "会议" });
    await controller.pause();
    const resumePromise = controller.resume();
    await vi.waitFor(() => expect(dependencies.resumeAudio).toHaveBeenCalled());

    const stopPromise = controller.stop();
    resumeAudio.resolve(undefined);

    await expect(resumePromise).rejects.toThrow("Recording operation was superseded");
    await expect(stopPromise).resolves.toBeUndefined();
    expect(controller.getStatus()).toBe("completed");
    expect(controller.getSession()?.status).toBe("completed");
  });

  it("enters failed when markInterrupted rejects and allows a later start", async () => {
    const firstSession = makeSession("session-1");
    const secondSession = makeSession("session-2");
    const createSession = vi.fn().mockResolvedValueOnce(firstSession).mockResolvedValueOnce(secondSession);
    const { controller } = makeController({
      createSession,
      markInterrupted: vi.fn(async () => Promise.reject(new Error("Could not mark interrupted")))
    });

    await controller.start({ title: "会议" });
    await expect(controller.interrupt(new Error("Obsidian unloaded"))).rejects.toThrow("Could not mark interrupted");
    expect(controller.getStatus()).toBe("failed");
    expect(firstSession.status).toBe("failed");

    await controller.start({ title: "恢复场" });
    expect(controller.getStatus()).toBe("recording");
    expect(controller.getSession()).toBe(secondSession);
  });

  it("keeps interrupted state when an in-flight stop resolves later", async () => {
    const stopAudio = deferred<{ durationSeconds: number }>();
    const { controller } = makeController({
      stopAudio: vi.fn(async () => stopAudio.promise)
    });

    await controller.start({ title: "会议" });
    const stopPromise = controller.stop();
    await vi.waitFor(() => expect(controller.getStatus()).toBe("stopping"));

    await controller.interrupt(new Error("Obsidian unloaded"));
    stopAudio.resolve({ durationSeconds: 1800 });

    await expect(stopPromise).rejects.toThrow("Recording was interrupted");
    expect(controller.getStatus()).toBe("interrupted");
    expect(controller.getSession()?.status).toBe("interrupted");
  });

  it("stops transcription before audio and analyzes after audio stops", async () => {
    const events: string[] = [];
    const { controller } = makeController({
      stopTranscription: vi.fn(async () => {
        events.push("stopTranscription");
      }),
      stopAudio: vi.fn(async () => {
        events.push("stopAudio");
        return { durationSeconds: 1800 };
      }),
      analyze: vi.fn(async () => {
        events.push("analyze");
      })
    });

    await controller.start({ title: "会议" });
    await controller.stop();

    expect(events).toEqual(["stopTranscription", "stopAudio", "analyze"]);
  });

  it("rejects pause resume and stop while idle", async () => {
    const { controller } = makeController();

    await expect(controller.pause()).rejects.toThrow("Cannot pause recording while idle");
    await expect(controller.resume()).rejects.toThrow("Cannot resume recording while idle");
    await expect(controller.stop()).rejects.toThrow("Cannot stop recording while idle");
  });
});

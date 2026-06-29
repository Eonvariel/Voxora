import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  getMeetingsRootFolder,
  normalizeSettings
} from "../src/settings";

describe("settings", () => {
  it("keeps stable defaults for first launch", () => {
    expect(DEFAULT_SETTINGS.meetingFolder).toBe("Meetings");
    expect(DEFAULT_SETTINGS.enableAnalysis).toBe(true);
    expect(DEFAULT_SETTINGS.saveAudio).toBe(true);
    expect(DEFAULT_SETTINGS.autoAnalyze).toBe(true);
  });

  it("normalizes missing persisted settings", () => {
    const settings = normalizeSettings({
      notesFolder: "Work/Meetings",
      analysis: { baseUrl: "https://example.com/v1" }
    });

    expect(settings.meetingFolder).toBe("Work/Meetings");
    expect(settings.analysis.baseUrl).toBe("https://example.com/v1");
    expect(settings.analysis.model).toBe("");
  });

  it("keeps generated meeting folders under the single configured root", () => {
    const settings = normalizeSettings({
      meetingFolder: "6-Meetings/工作会议"
    });

    expect(getMeetingsRootFolder(settings)).toBe("6-Meetings/工作会议");
  });

  it("keeps recording and automatic analysis enabled when old data disabled them", () => {
    const settings = normalizeSettings({
      saveAudio: false,
      autoAnalyze: false
    });

    expect(settings.saveAudio).toBe(true);
    expect(settings.autoAnalyze).toBe(true);
  });

  it("allows AI summaries to be disabled explicitly", () => {
    const settings = normalizeSettings({
      enableAnalysis: false
    });

    expect(settings.enableAnalysis).toBe(false);
  });
});

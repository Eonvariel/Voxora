import { describe, expect, it } from "vitest";
import {
  formatClockTime,
  formatDuration,
  formatTimestamp,
  makeDefaultMeetingTitle,
  makeSafeFilename
} from "../src/time";

describe("time helpers", () => {
  const date = new Date(2026, 5, 28, 7, 30, 5);

  it("formats elapsed seconds as transcript timestamps", () => {
    expect(formatTimestamp(5)).toBe("00:00:05");
    expect(formatTimestamp(754)).toBe("00:12:34");
    expect(formatTimestamp(3661)).toBe("01:01:01");
  });

  it("formats duration seconds for frontmatter", () => {
    expect(formatDuration(1800)).toBe("30:00");
  });

  it("creates readable titles and safe filenames", () => {
    expect(makeDefaultMeetingTitle(date)).toBe("会议记录 2026-06-28 07-30");
    expect(makeSafeFilename("设计/评审: 第 1 次")).toBe("设计-评审-第-1-次");
  });

  it("formats clock time with minutes", () => {
    expect(formatClockTime(date)).toBe("2026-06-28 07:30");
  });
});

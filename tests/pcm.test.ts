import { describe, expect, it } from "vitest";
import {
  floatToInt16Pcm,
  mergeBlobs,
  resampleFloatToInt16Pcm
} from "../src/audio/pcm";

describe("PCM helpers", () => {
  it("converts float audio samples into signed 16-bit PCM", () => {
    const pcm = floatToInt16Pcm(new Float32Array([-1, -0.5, 0, 0.5, 1]));
    expect(Array.from(pcm)).toEqual([-32768, -16384, 0, 16383, 32767]);
  });

  it("merges blobs into one blob with the requested type", async () => {
    const blob = mergeBlobs([new Blob(["a"]), new Blob(["b"])], "audio/webm");
    expect(blob.type).toBe("audio/webm");
    expect(await blob.text()).toBe("ab");
  });

  it("resamples browser audio to the declared ASR sample rate", () => {
    const pcm = resampleFloatToInt16Pcm(
      new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.5]),
      48000,
      16000
    );

    expect(Array.from(pcm)).toEqual([0, 24575]);
  });
});

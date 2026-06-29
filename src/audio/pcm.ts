export function floatToInt16Pcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

export function resampleFloatToInt16Pcm(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Int16Array {
  if (
    sourceSampleRate <= 0 ||
    targetSampleRate <= 0 ||
    sourceSampleRate === targetSampleRate
  ) {
    return floatToInt16Pcm(input);
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const resampled = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const before = Math.floor(position);
    const after = Math.min(before + 1, input.length - 1);
    const weight = position - before;
    resampled[index] = input[before] * (1 - weight) + input[after] * weight;
  }

  return floatToInt16Pcm(resampled);
}

export function mergeBlobs(blobs: Blob[], type: string): Blob {
  return new Blob(blobs, { type });
}

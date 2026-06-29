import { MeetingFrontmatter } from "./domain";

export function shouldOfferRecovery(input: { status: string; audioPath?: string }): boolean {
  return input.status === "interrupted" && input.audioPath !== undefined && input.audioPath.trim().length > 0;
}

export function buildInterruptedFrontmatter(
  frontmatter: MeetingFrontmatter,
  durationSeconds: number
): MeetingFrontmatter {
  return {
    ...frontmatter,
    status: "interrupted",
    durationSeconds
  };
}

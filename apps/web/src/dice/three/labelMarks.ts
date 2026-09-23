/**
 * What is drawn on a 3D die's face beside the numeral: the underline a 6
 * and a 9 always carry, and a ring around every numeral on a challenge
 * die, so the challenge's dice differ from yours in shape and not only in
 * the color of their bodies.
 */
export function labelMarks(text: string, variant: "normal" | "challenge" | undefined): { underline: boolean; ring: boolean } {
  return { underline: text === "6" || text === "9", ring: variant === "challenge" };
}

export function calculateSimilarity(s1: string, s2: string): number {
  const clean1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean1 === clean2) return 1.0;
  if (!clean1 || !clean2) return 0.0;

  const track = Array(clean2.length + 1).fill(null).map(() =>
    Array(clean1.length + 1).fill(null));
  for (let i = 0; i <= clean1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= clean2.length; j += 1) {
    track[j][0] = j;
  }
  for (let j = 1; j <= clean2.length; j += 1) {
    for (let i = 1; i <= clean1.length; i += 1) {
      const indicator = clean1[i - 1] === clean2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  const distance = track[clean2.length][clean1.length];
  const maxLen = Math.max(clean1.length, clean2.length);
  return 1.0 - distance / maxLen;
}

export function extractCleanEmail(emailStr: string | null | undefined): string {
  if (!emailStr) return '';
  let str = String(emailStr).trim();
  const angleMatch = str.match(/<([^>]+)>/);
  if (angleMatch && angleMatch[1]) {
    str = angleMatch[1];
  }
  str = str.replace(/^["']|["']$/g, '').trim().toLowerCase();
  const emailMatch = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return emailMatch ? emailMatch[0].toLowerCase() : str.toLowerCase();
}

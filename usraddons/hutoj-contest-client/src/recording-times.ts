// MediaMTX records timestamps with sub-millisecond precision. Rounding the first
// seek backward can place it before the first available recording segment.
export function recordingStart(start: string, offsetSeconds: number): string {
  const match =
    typeof start === 'string' &&
    start.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/);
  const milliseconds = Date.parse(start);
  if (
    !match ||
    !Number.isFinite(milliseconds) ||
    !Number.isInteger(offsetSeconds) ||
    offsetSeconds < 0
  ) {
    throw new RangeError('Invalid recording timestamp');
  }
  if (offsetSeconds === 0) {
    return start;
  }
  const remainder = (match[1] || '').slice(3);
  return new Date(milliseconds + offsetSeconds * 1000)
    .toISOString()
    .replace(/Z$/, `${remainder}Z`);
}

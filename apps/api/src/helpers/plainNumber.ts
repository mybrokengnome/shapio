/**
 * A number as exact decimal text, never in exponent notation: the digits of its shortest round-trip form
 * (`String`), with the point moved (`1e-7` → `0.0000001`, `1e21` → `1000000000000000000000`). Decimal and
 * big-integer values are plain digit strings, which `String` alone does not give for very small or large numbers.
 */
export const plainNumber = (value: number): string => {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) {
    return text;
  }
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  if (point <= 0) {
    return `${sign}0.${'0'.repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
};

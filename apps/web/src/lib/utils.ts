export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/** 中文数字章节序号：1 → 一，12 → 十二 */
export function toChineseNumber(n: number): string {
  const digits = "零一二三四五六七八九";
  if (n <= 10) return n === 10 ? "十" : (digits[n] ?? "");
  if (n < 20) return `十${digits[n - 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

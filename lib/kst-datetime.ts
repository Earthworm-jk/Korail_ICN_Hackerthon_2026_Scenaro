/** KST datetime-local 문자열 ↔ ISO(+09:00) 변환 — UI 입력과 constraints 직렬화가 같은 경로를 쓴다 */

export function toKstLocalInput(iso: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const kst = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())}T${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
}

export function fromKstLocalInput(value: string): string {
  return `${value}:00+09:00`;
}

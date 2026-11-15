/** 99실까지는 기존 번호를 유지하고, 이후에는 층과 순서를 구분한다. */
export const MAX_ROOM_SEQUENCE = 9999;

export function roomNumber(floor: number, sequence: number): string {
  return sequence < 100 ? `${floor}${String(sequence).padStart(2, "0")}` : `${floor}-${sequence}`;
}

export function parseRoomNumber(no: string): { floor: number; sequence: number } | undefined {
  const match = /^(\d{1,2})-(\d{3,4})$/.exec(no) ?? /^(\d{1,2})(\d{2})$/.exec(no);
  if (!match) return undefined;
  const floor = Number(match[1]), sequence = Number(match[2]);
  if (floor < 1 || floor > 25 || sequence < 1 || sequence > MAX_ROOM_SEQUENCE || roomNumber(floor, sequence) !== no) return undefined;
  return { floor, sequence };
}

export function compareRoomNumbers(a: string, b: string): number {
  const x = parseRoomNumber(a), y = parseRoomNumber(b);
  return x && y ? x.floor - y.floor || x.sequence - y.sequence : a.localeCompare(b, "ko-KR", { numeric: true });
}

/** Official room-code alphabet — same as server/rooms.js CODE_CHARS (no I, O, 0, 1). */
export const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Room codes are always this many characters (四個字, not digits-only). */
export const ROOM_CODE_LENGTH = 4;

const ROOM_CODE_SET = new Set(ROOM_CODE_CHARS);

export function normalizeJoinCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .split("")
    .filter((ch) => ROOM_CODE_SET.has(ch))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);
}

/** Pull a room code out of a paste: a /r/CODE share link, or a typed/copied code. */
export function extractJoinCode(raw) {
  const text = String(raw || "").trim();
  const fromPath = text.match(/\/r\/([A-Za-z0-9]+)/i);
  if (fromPath) return normalizeJoinCode(fromPath[1]);
  if (/^https?:\/\//i.test(text)) return "";
  return normalizeJoinCode(text);
}

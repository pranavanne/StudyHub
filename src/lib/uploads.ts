/** Shared upload rules for the study library (chat attachments and the Documents page). */
export const ACCEPTED_UPLOAD_ACCEPT =
  "application/pdf,.pdf,.doc,.docx,.ppt,.pptx," +
  "application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const EXTENSIONS = ["pdf", "doc", "docx", "ppt", "pptx"] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function fileExtension(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? "";
}

export function isAcceptedUpload(filename: string): boolean {
  return (EXTENSIONS as readonly string[]).includes(fileExtension(filename));
}

/** crypto.randomUUID is unavailable on non-secure origins (e.g. http://192.168.x.x), so fall back to getRandomValues. */
export function newFileId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uploadContentType(filename: string): string {
  return MIME_BY_EXTENSION[fileExtension(filename)] ?? "application/octet-stream";
}

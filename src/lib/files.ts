// What may be uploaded, decided in one place.
//   The type comes from the file's own first bytes. The name and the type the browser claims are ignored,
//   so a program renamed to receipt.jpg is refused.
//   Allowed: JPEG, PNG, WebP and PDF. Nothing that can carry a script (SVG, HTML) is accepted.
//   Photos from some iPhones are HEIC. Those need converting to JPEG first.

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PER_RECORD = 20;
export const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export type Kind = { mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; ext: "jpg" | "png" | "webp" | "pdf"; image: boolean };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function sniff(bytes: Uint8Array): Kind | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", image: true };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", image: true };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: "webp", image: true };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf", image: false };
  return null;
}

// A name that is safe to show and to put in a download header: no folders, no control characters, no odd quotes.
export function cleanName(original: string, ext: string): string {
  const base = original.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const safe = base.replace(/[\u0000-\u001f\u007f"<>:|?*\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe || "file"}.${ext}`;
}

export const humanSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

// A storage key is the only thing that ever reaches the disk path, and it is never built from user input.
export const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validate(original: string, bytes: Uint8Array): { kind: Kind; name: string } {
  if (!bytes.length) throw new Error("That file is empty.");
  if (bytes.length > MAX_BYTES) throw new Error(`That file is ${humanSize(bytes.length)}. The limit is ${humanSize(MAX_BYTES)}.`);
  const kind = sniff(bytes);
  if (!kind) throw new Error("Only photos (JPEG, PNG, WebP) and PDF files can be attached.");
  return { kind, name: cleanName(original, kind.ext) };
}

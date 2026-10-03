import { KEY_PATTERN, MAX_BYTES, cleanName, humanSize, sniff, validate } from "../src/lib/files";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};
const throws = (name: string, fn: () => unknown, text: string) => {
  try { fn(); failed++; console.log("FAIL", name, "did not throw"); }
  catch (e) { const ok = String((e as Error).message).includes(text); if (!ok) failed++; console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got "${(e as Error).message}"`); }
};
const pad = (head: number[], total = 64) => Uint8Array.from([...head, ...new Array(Math.max(0, total - head.length)).fill(0)]);

const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const EXE = pad([0x4d, 0x5a, 0x90, 0x00]); // Windows program
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HEIC = pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);

eq("a JPEG is recognised", sniff(JPEG)?.mime, "image/jpeg");
eq("a PNG is recognised", sniff(PNG)?.mime, "image/png");
eq("a WebP is recognised", sniff(WEBP)?.mime, "image/webp");
eq("a PDF is recognised", sniff(PDF)?.mime, "application/pdf");
eq("a Windows program is not", sniff(EXE), null);
eq("an HTML page is not", sniff(HTML), null);
eq("an SVG, which can carry a script, is not", sniff(SVG), null);
eq("an iPhone HEIC photo is not accepted yet", sniff(HEIC), null);
eq("a RIFF file that is not WebP (like a WAV) is not", sniff(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])), null);
eq("a file too short to identify is not", sniff(Uint8Array.from([0xff, 0xd8, 0xff])), null);

// The name the person gave plays no part in the decision.
throws("a program renamed to receipt.jpg is refused", () => validate("receipt.jpg", EXE), "Only photos");
eq("a JPEG named .txt is still accepted, and renamed to .jpg", validate("notes.txt", JPEG).name, "notes.jpg");
eq("a PDF named .png is treated as a PDF", validate("scan.png", PDF).kind.mime, "application/pdf");
throws("an empty file is refused", () => validate("a.jpg", new Uint8Array(0)), "empty");
throws("a file over the limit is refused", () => validate("big.jpg", (() => { const b = new Uint8Array(MAX_BYTES + 1); b.set([0xff, 0xd8, 0xff]); return b; })()), "limit is 8.0 MB");
eq("a file exactly at the limit is accepted", (() => { const b = new Uint8Array(MAX_BYTES); b.set([0xff, 0xd8, 0xff]); return validate("ok.jpg", b).kind.mime; })(), "image/jpeg");

// Names.
eq("folders are stripped from the name", cleanName("..\\..\\windows\\evil.jpg", "jpg"), "evil.jpg");
eq("a path with slashes is stripped", cleanName("/etc/passwd", "jpg"), "passwd.jpg");
eq("quotes and angle brackets cannot reach a header", cleanName('a"b<c>.jpg', "jpg"), "a b c.jpg");
eq("control characters are removed", cleanName("a\u0000b\nc.jpg", "jpg"), "a b c.jpg");
eq("an empty name becomes file", cleanName("", "pdf"), "file.pdf");
eq("very long names are cut", cleanName("x".repeat(500) + ".jpg", "jpg").length, 84);

// Storage keys cannot be used to climb out of the folder.
eq("a normal key is accepted", KEY_PATTERN.test("2026/10/0b6f3e1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b"), true);
eq("a key with .. is refused", KEY_PATTERN.test("2026/10/../../etc/passwd"), false);
eq("a key with a drive letter is refused", KEY_PATTERN.test("C:/windows/system32"), false);
eq("a key with a backslash is refused", KEY_PATTERN.test("2026\\10\\0b6f3e1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b"), false);
eq("an upper-case key is refused", KEY_PATTERN.test("2026/10/0B6F3E1A-1C2D-4E5F-8A9B-0C1D2E3F4A5B"), false);

eq("sizes read well", `${humanSize(500)} | ${humanSize(2048)} | ${humanSize(3 * 1048576)}`, "500 B | 2 KB | 3.0 MB");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

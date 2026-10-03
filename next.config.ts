import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF library reads its font files from its own folder at runtime, so it must not be bundled.
  serverExternalPackages: ["pdfkit"],
  experimental: {
    // Photos and scanned receipts. The upload limit in src/lib/files.ts is 8 MB; this leaves room for the form's own overhead.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;

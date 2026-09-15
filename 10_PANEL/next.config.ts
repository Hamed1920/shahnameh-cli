import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js is loaded at runtime by lib/documents.ts; bundling its legacy build breaks it.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    serverActions: {
      // Reviewer uploads go through the decide action. Server Actions cap the
      // body at 1MB by default; this allows a few full-size reference images
      // plus multipart overhead. Per-file limit is enforced in lib/indexing.ts.
      bodySizeLimit: '60mb',
    },
  },
  logging: {
    // Every open tab polls /api/live every 2s (components/live-refresh.tsx).
    incomingRequests: { ignore: [/\/api\/live/] },
  },
};

export default nextConfig;

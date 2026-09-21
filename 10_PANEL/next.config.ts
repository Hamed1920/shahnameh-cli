import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js is loaded at runtime by lib/documents.ts; bundling its legacy build breaks it.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    serverActions: {
      // Reviewer uploads go through the decide action, and footage added to an
      // episode goes through addFootage -- which is video, so this is sized for
      // that rather than for reference images. Server Actions cap the body at
      // 1MB by default. Per-file limits live in lib/indexing.ts
      // (MAX_UPLOAD_BYTES, MAX_FOOTAGE_BYTES); this is the whole multipart body.
      bodySizeLimit: '640mb',
    },
  },
  // Bookmarks from when the panel ran one project: send them to the picker
  // rather than 404, since /review now reads as a project called "review".
  async redirects() {
    return ['review', 'decided', 'references', 'entities', 'learnings', 'prompts', 'queue', 'episodes'].map((page) => ({
      source: `/${page}`,
      destination: '/',
      permanent: false,
    }))
  },
  logging: {
    // Every open tab polls /<project>/api/live every 2s (components/live-refresh.tsx).
    incomingRequests: { ignore: [/\/api\/live/] },
  },
};

export default nextConfig;

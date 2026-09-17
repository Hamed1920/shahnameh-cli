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
  // Bookmarks from when the panel ran one project: send them to the picker
  // rather than 404, since /review now reads as a project called "review".
  async redirects() {
    return ['review', 'decided', 'references', 'entities', 'learnings', 'prompts', 'queue'].map((page) => ({
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

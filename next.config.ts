import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // "Cases" are called "sets" now: keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/cases", destination: "/sets", permanent: true },
      { source: "/cases/:path*", destination: "/sets/:path*", permanent: true },
      { source: "/projects/:id/cases", destination: "/projects/:id/sets", permanent: true },
    ];
  },
  experimental: {
    // Document uploads: up to 20 files, 100 MB in total (see MAX_DOCUMENT_UPLOAD_BYTES).
    serverActions: { bodySizeLimit: "101mb" },
    // proxy.ts makes Next.js buffer request bodies; without this they are cut at 10 MB.
    proxyClientMaxBodySize: "101mb",
  },
};

export default nextConfig;

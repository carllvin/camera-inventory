import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Document uploads: up to 20 files, 100 MB in total (see MAX_DOCUMENT_UPLOAD_BYTES).
    serverActions: { bodySizeLimit: "101mb" },
    // proxy.ts makes Next.js buffer request bodies; without this they are cut at 10 MB.
    proxyClientMaxBodySize: "101mb",
  },
};

export default nextConfig;

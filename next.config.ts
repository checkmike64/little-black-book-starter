import type { NextConfig } from "next";
import { privateHeaderList } from "./lib/private-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: privateHeaderList,
      },
    ];
  },
};

export default nextConfig;

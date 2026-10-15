import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/waitlist/:path*", destination: "/", permanent: false }];
  },
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "sjfwqrfrxcmmcgibqmsl.supabase.co",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    // Файл из чата идёт через proxy: без этого тело обрезается на 10 МБ, а файл бывает до 20 МБ
    proxyClientMaxBodySize: "25mb",
  },
  cacheComponents: true,
  async redirects() {
    // Корень приложения — главная страница CRM
    return [{ source: "/", destination: "/my-day", permanent: false }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

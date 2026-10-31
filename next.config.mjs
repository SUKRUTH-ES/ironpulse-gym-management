/** @type {import('next').NextConfig} */
const nextConfig = {
  // Every page shows live, per-user data from MySQL/MongoDB, so pages are
  // rendered on each request instead of using Cache Components.
  cacheComponents: false,
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

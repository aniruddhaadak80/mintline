import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * These packages must stay outside the server bundle.
   *
   * `@electric-sql/pglite` reaches into `node:fs` and `node:path` with a `URL`
   * it constructs itself. When the bundler inlines it, that `URL` comes from a
   * different realm than Node's, and Node rejects it with
   * `The "path" argument must be of type string or an instance of Buffer or URL`.
   * Keeping the package external makes it a real `require` at runtime, which is
   * what it expects.
   *
   * `@neondatabase/serverless` is external for the same reason: it is a
   * transport over `fetch` and its edge assumptions do not survive bundling.
   */
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
};

export default nextConfig;
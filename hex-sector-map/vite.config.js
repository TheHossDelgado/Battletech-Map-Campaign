import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Lets Discord's tunnel/proxy reach the dev server (see README, "Testing in Discord")
    allowedHosts: true,
  },
});

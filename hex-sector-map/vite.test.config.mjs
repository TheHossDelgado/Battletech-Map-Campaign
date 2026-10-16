import { defineConfig } from "vite";
export default defineConfig({
  root: "/home/claude/hex-sector-map",
  build: { outDir: "/tmp/hextest/dist", emptyOutDir: true },
  resolve: { alias: { "@supabase/supabase-js": "/tmp/hextest/fake-supabase.js" } },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://fake.supabase.co"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("fake"),
  },
});

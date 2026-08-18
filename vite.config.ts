// The shared TanStack Start configuration provides the framework plugins and
// build defaults. This project only supplies its server entry override.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Use the application server entry for the SSR build.
    server: { entry: "server" },
  },
});

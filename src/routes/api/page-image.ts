import { createFileRoute } from "@tanstack/react-router";

import { readPageFile } from "@/lib/scanner.server";

export const Route = createFileRoute("/api/page-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const filePath = new URL(request.url).searchParams.get("path");
        if (!filePath) return new Response("Missing path", { status: 400 });
        try {
          const { buf, mime } = await readPageFile(filePath);
          return new Response(new Uint8Array(buf), {
            headers: { "Content-Type": mime, "Cache-Control": "private, max-age=300" },
          });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "Not available", {
            status: 404,
          });
        }
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/build-me-a-beautiful-modern-habit-tracker-web-application-it-needs-a-sleek-dark-a08d12/",
  build: { outDir: "dist", assetsDir: "assets" },
  server: { port: 3000 },
});

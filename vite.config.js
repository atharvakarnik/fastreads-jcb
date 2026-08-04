import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@niivue/dcm2niix"],
  },
  worker: {
    format: "es",
  },
});

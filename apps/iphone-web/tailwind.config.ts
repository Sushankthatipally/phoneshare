import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/shared-ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        beam: "#22d3ee",
        pulse: "#00ff88",
        signal: "#ffb800",
      },
    },
  },
  plugins: [],
} satisfies Config;


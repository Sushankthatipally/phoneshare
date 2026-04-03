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
        ink: "#07101d",
        beam: "#22d3ee",
        glow: "#00ff88",
        signal: "#ffb800",
      },
      boxShadow: {
        beam: "0 0 40px rgba(34, 211, 238, 0.25)",
      },
    },
  },
  plugins: [],
} satisfies Config;


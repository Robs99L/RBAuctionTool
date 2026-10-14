import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#18201d",
        cream: "#f5f2ea",
        forest: "#174b3a",
        lime: "#d9f55f",
        coral: "#f06c4f",
      },
      boxShadow: {
        card: "0 24px 70px rgba(24, 32, 29, 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;

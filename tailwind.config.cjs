/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			colors: {
				"accent-focus": "var(--accent-focus)",
				"primary-focus": "var(--primary-focus)",
				"secondary-focus": "var(--secondary-focus)",
			}
		},
	},
	plugins: [require("daisyui"), require("@tailwindcss/typography")],
	daisyui: {
		themes: [
			{
				black: {
					primary: "#6247aa",
					"--primary": "#6247aa",
					"primary-focus": "#a06cd5",
					"--primary-focus": "#a06cd5",
					"primary-content": "#ffffff",

					secondary: "#159f91",
					"secondary-focus": "#1bccba",
					"--secondary-focus": "#1bccba",
					"secondary-content": "#ffffff",

					accent: "#ff6d00",
					"accent-focus": "#ff8500",
					"--accent-focus": "#ff8500",
					"accent-content": "#000000",

					neutral: "#333333",
					"--neutral": "#333333",
					"neutral-focus": "#4d4d4d",
					"--neutral-focus": "#4d4d4d",
					"neutral-content": "#ffffff",

					"base-100": "#1c1d1f",
					"--base-100": "#1c1d1f",
					"base-200": "#242527",
					"--base-200": "#242527",
					"base-300": "#303133",
					"--base-300": "#303133",
					"base-content": "#ffffff",
					"--base-content": "#ffffff",

					info: "#0000ff",
					success: "#45cd5c",
					warning: "#d4c25e",
					error: "#df4645",

					"--rounded-box": "0.5rem",
					"--rounded-btn": "0.5rem",
					"--rounded-badge": "0.5rem",

					"--animation-btn": "400ms",
					"--animation-input": "200ms",

					"--btn-text-case": "uppercase",
					"--navbar-padding": ".5rem",
					"--border-btn": "1px",
				},

				light: {
					primary: "#65c3c8",
					"primary-focus": "#42b2b8",
					"primary-content": "#ffffff",

					secondary: "#ef9fbc",
					"secondary-focus": "#e7739e",
					"secondary-content": "#ffffff",

					accent: "#eeaf3a",
					"accent-focus": "#e09915",
					"accent-content": "#ffffff",

					neutral: "#261230",
					"neutral-focus": "#200f29",
					"neutral-content": "#ffffff",

					"base-100": "#faf7f5",
					"base-200": "#efeae6",
					"base-300": "#e7e2df",
					"base-content": "#261230",

					info: "#1c92f2",
					success: "#009485",
					warning: "#ff9900",
					error: "#ff5724",

					"--rounded-box": "0.5rem",
					"--rounded-btn": "0.5rem",
					"--rounded-badge": "0.5rem",

					"--animation-btn": "400ms",
					"--animation-input": "200ms",

					"--btn-text-case": "uppercase",
					"--navbar-padding": ".5rem",
					"--border-btn": "1px",
				},
			},
		],
	},
};

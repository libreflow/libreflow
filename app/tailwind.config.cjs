/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			colors: {
				primary: "#fafafa",
				secondary: "#191919",
				accent: "#00daa2"
			},
		},
	},
	darkMode: "class",
	plugins: [],
};

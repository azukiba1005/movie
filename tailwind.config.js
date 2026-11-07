/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        resolve: {
          bg: '#18181b',
          panel: '#1f1f23',
          surface: '#27272a',
          border: '#3f3f46',
          accent: '#06b6d4',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '"Hiragino Kaku Gothic ProN"',
          '"Noto Sans JP"',
          'Meiryo',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};


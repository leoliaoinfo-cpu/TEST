/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#fdf6ee',
        s1: '#fffaf4',
        s2: '#fef0dc',
        s3: '#fde8c8',
        bdr: '#f0d9b8',
        accent: {
          DEFAULT: '#c9670a',
          light: '#fef0dc',
        },
        danger: {
          DEFAULT: '#c03030',
          light: '#fdeaea',
        },
        ok: {
          DEFAULT: '#2a8a50',
          light: '#e6f5ec',
        },
        ink: {
          DEFAULT: '#2c1a08',
          2: '#7a5030',
          3: '#b88860',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', '"PingFang TC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 4px rgba(44,26,8,0.08)',
        panel: '0 4px 20px rgba(44,26,8,0.12)',
      },
    },
  },
  plugins: [],
};

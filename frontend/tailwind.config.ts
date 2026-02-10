import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand Red — warm crimson, confident but not aggressive
        primary: {
          50: '#FFF5F5',
          100: '#FED7D7',
          200: '#FEB2B2',
          300: '#FC8181',
          400: '#F56565',
          500: '#E53E3E',
          600: '#C53030',
          700: '#9B2C2C',
          800: '#822727',
          900: '#63171B',
          950: '#3B0D0D',
        },
        // Yellowish Orange accent — warm amber for highlights
        accent: {
          50: '#FFFAF0',
          100: '#FEECDC',
          200: '#FCD9B6',
          300: '#FDBA74',
          400: '#F6AD55',
          500: '#ED8936',
          600: '#DD6B20',
          700: '#C05621',
          800: '#9C4221',
          900: '#7B341E',
          950: '#4A1D0F',
        },
        // Warm neutral grays — slightly warm-tinted, not cold blue
        warm: {
          50: '#FAFAF7',
          100: '#F5F3F0',
          200: '#EBE8E3',
          300: '#DDD9D2',
          400: '#B8B2A8',
          500: '#9C9590',
          600: '#6B6560',
          700: '#4A4540',
          800: '#2D2A26',
          900: '#1A1715',
        },
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        'soft': '0 1px 3px 0 rgba(26, 23, 21, 0.04), 0 1px 2px -1px rgba(26, 23, 21, 0.03)',
        'card': '0 2px 8px -2px rgba(26, 23, 21, 0.06), 0 1px 3px -1px rgba(26, 23, 21, 0.04)',
        'elevated': '0 8px 24px -4px rgba(26, 23, 21, 0.08), 0 2px 8px -2px rgba(26, 23, 21, 0.04)',
        'dropdown': '0 12px 32px -4px rgba(26, 23, 21, 0.12), 0 4px 12px -2px rgba(26, 23, 21, 0.06)',
      },
      keyframes: {
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.2s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
export default config

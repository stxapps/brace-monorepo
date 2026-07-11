/** @type {import('tailwindcss').Config} */
module.exports = {
  // Workspace packages ship raw TS source, so any package this app renders
  // components/classNames from must be listed here too.
  content: ['./src/**/*.{js,jsx,ts,tsx}', '../../packages/expo-react/src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};

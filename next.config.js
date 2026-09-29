const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep visited pages in the client router cache so going back/forth
    // between tabs is instant instead of re-fetching every time.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

module.exports = withPWA(nextConfig);

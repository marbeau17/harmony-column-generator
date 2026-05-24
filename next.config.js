/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // hub-deploy が静的アセット (hub.css / hub.js) を FTP に push するために
    // Vercel lambda の bundle に templates/hub/** を含める。これがないと
    // serverless 環境で fs.readFileSync('templates/hub/...') が ENOENT になる。
    outputFileTracingIncludes: {
      '/api/hub/deploy': ['./templates/hub/**/*'],
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

module.exports = nextConfig;

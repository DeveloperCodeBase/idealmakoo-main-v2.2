import type { NextConfig } from 'next';
import publicImages from './src/data/public-image-dimensions.json';
import {HARD_MAX_UPLOAD_BYTES,MULTIPART_OVERHEAD_BYTES} from './src/lib/upload-policy';
const imagePaths=Object.keys(publicImages);
if(imagePaths.some(path=>/[?*\[\]{}()!,\\]/.test(path)))throw new Error('Public image paths must be literal safe asset names.');
// Next bounds localPatterns to 25 entries. One literal brace alternation
// expresses the exact 108-file allowlist without a directory wildcard.
const imagePathPattern=imagePaths.length===1?imagePaths[0]:'{'+imagePaths.join(',')+'}';
const nextConfig: NextConfig = {
  output: 'standalone',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  // Preserve the request origin for internal rewrites. NextURL normalizes a
  // loopback IP to localhost, which otherwise creates an external self-proxy.
  skipProxyUrlNormalize:true,
  images: {
    // No remote images or authenticated API endpoints enter the public cache.
    localPatterns: [{pathname:imagePathPattern,search:''}],
    remotePatterns: [],
    formats: ['image/webp'],
    qualities: [75],
    // Preserve the existing candidates and fill the 384→640 gap. The mobile
    // carousel's 58vw slot can need ~418 source pixels at DPR 1.75, so 480
    // avoids an oversized download without changing its artwork or layout.
    imageSizes: [32, 48, 64, 96, 128, 256, 384, 480],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pg', 'sharp', 'pdfkit', 'qrcode', 'nodemailer'],
  outputFileTracingExcludes: {
    '/*': ['./docs/**/*','./tests/**/*','./e2e/**/*','./tmp/**/*','./storage/**/*','./backups/**/*','./test-results/**/*','./playwright-report/**/*','./.env*','./node_modules/@playwright/**/*','./node_modules/playwright/**/*','./node_modules/playwright-core/**/*'],
  },
  async headers() {
    const publicStaticHeaders = [
      { key: 'X-Public-Cache', value: '1' },
      { key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
    ];
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] },
    // Only bundled public assets may enter the service-worker cache. Uploaded
    // files and every API/document response retain their own access policy.
    { source: '/media/official/:path*', headers: publicStaticHeaders },
    { source: '/fonts/:path*', headers: publicStaticHeaders },
    { source: '/offline/:locale(fa|en|tr|ar|ru).html', headers: [
      ...publicStaticHeaders,
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    ] },
    ];
  },
  // The installed TypeScript 5 compiler API keeps full build-time checking
  // independent of detached CLI stdout capture in managed build environments.
  // Preserve the measured external stylesheet strategy and existing styles.
  experimental: {
    // Proxy otherwise truncates at 10 MiB before the route's administrator
    // policy can accept a larger file. Keep the same bounded request ceiling
    // as the upload parser and Caddy, including multipart envelope overhead.
    proxyClientMaxBodySize: HARD_MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
    cpus: 2, useTypeScriptCli: false, inlineCss: false, globalNotFound:true, optimizePackageImports: ['lucide-react'],
  },
};
export default nextConfig;

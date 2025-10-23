/** @type {import('next').NextConfig} */
const nextConfig = {
	async headers() {
			return [
				{
					source: '/:path*',
					headers: [
						{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
						{ key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
						{ key: 'Cross-Origin-Resource-Policy', value: 'same-site' }
					]
				},
				{
					// Explicitly mark static assets as CORP to satisfy COEP
					source: '/_next/static/:path*',
					headers: [
						{ key: 'Cross-Origin-Resource-Policy', value: 'same-site' }
					]
				},
				{
					source: '/public/:path*',
					headers: [
						{ key: 'Cross-Origin-Resource-Policy', value: 'same-site' }
					]
				}
			];
	}
};

export default nextConfig;

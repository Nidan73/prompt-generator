export type SecurityHeader = { key: string; value: string };

// Next injects inline hydration scripts, so script-src needs 'unsafe-inline'
// (a nonce would force dynamic rendering for every page). Dev adds eval and
// websockets for React refresh and HMR.
export function buildSecurityHeaders({
  isDev,
}: {
  isDev: boolean;
}): SecurityHeader[] {
  const csp =
    "default-src 'self'; " +
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}; ` +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' data:; " +
    `connect-src 'self'${isDev ? " ws: wss:" : ""}; ` +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" +
    (isDev ? "" : "; upgrade-insecure-requests");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];
}

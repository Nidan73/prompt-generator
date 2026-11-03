import { ogAlt, renderOgImage } from "../lib/og-image";

// Route segment config must be literal exports, so they are not re-exported.
export const alt = ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderOgImage();
}

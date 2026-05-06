import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/", // Don't let Google index the API routes directly
    },
    sitemap: "https://bhaithikkor.vercel.app/sitemap.xml",
  };
}

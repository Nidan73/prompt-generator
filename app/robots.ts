import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin"], // keep API routes and the admin UI out of search
    },
    sitemap: "https://bhaithikkor.vercel.app/sitemap.xml",
  };
}

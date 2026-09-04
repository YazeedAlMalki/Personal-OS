import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. Makes the app installable to the iPhone (and
// Android) home screen as a standalone, full-screen web app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal OS",
    short_name: "Personal OS",
    description: "A private personal intelligence platform.",
    start_url: "/",
    display: "standalone",
    background_color: "#14161b",
    theme_color: "#14161b",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

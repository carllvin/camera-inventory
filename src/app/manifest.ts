import type { MetadataRoute } from "next";

/** Installable on phones ("Add to Home Screen"): name, colors and the iris icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Camera Inventory",
    short_name: "Camera Inv.",
    description: "Rental equipment of the camera department: projects, sets, delivery and return notes.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f3",
    theme_color: "#d9480f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}

import type { MetadataRoute } from "next";

/** Lets phones add AutoMeta to the home screen; on an iPhone that is what enables pushes. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AutoMeta – Gebrauchtwagen aus allen Börsen",
    short_name: "AutoMeta",
    description: "Einmal suchen, Angebote aus vielen Fahrzeugbörsen vergleichen, bei neuen Treffern Bescheid bekommen.",
    lang: "de",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#1d5bd8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

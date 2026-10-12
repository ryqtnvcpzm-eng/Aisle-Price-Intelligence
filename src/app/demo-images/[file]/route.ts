import { findDemoListing, type DemoShape } from "@/server/providers/demo/catalog";
import { hash32 } from "@/server/providers/demo/simulate";

/**
 * Deterministic product illustrations for the fictional demo catalog, so demo
 * mode never shows (or hotlinks) real product photography.
 */
function svg(shape: DemoShape, hue: number, brand: string, label: string) {
  const c1 = `hsl(${hue} 42% 46%)`;
  const c2 = `hsl(${hue} 46% 34%)`;
  const lid = `hsl(${hue} 18% 18%)`;
  const initials = brand
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const tag = label.length > 14 ? `${label.slice(0, 13)}…` : label;
  const text = (y: number, size: number, content: string, weight = 600, fill = "#fff", opacity = 1) =>
    `<text x="200" y="${y}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text',Inter,Helvetica,Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}" letter-spacing="0.2">${content.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
  const shadow = `<ellipse cx="200" cy="352" rx="112" ry="12" fill="#000" fill-opacity="0.10"/>`;
  let body = "";
  switch (shape) {
    case "tub":
      body = `${shadow}<rect x="98" y="92" width="204" height="40" rx="12" fill="${lid}"/><rect x="88" y="124" width="224" height="226" rx="26" fill="url(#g)"/><rect x="88" y="124" width="224" height="226" rx="26" fill="url(#shine)"/><rect x="112" y="184" width="176" height="112" rx="14" fill="#fff" fill-opacity="0.94"/>${text(226, 30, initials, 700, c2)}${text(254, 13, brand, 600, "#1d1d1f", 0.85)}${text(278, 12, tag, 500, "#6e6e73")}`;
      break;
    case "pouch":
      body = `${shadow}<path d="M110 92 h180 l14 250 q0 10 -10 10 h-188 q-10 0 -10 -10z" fill="url(#g)"/><path d="M110 92 h180 l14 250 q0 10 -10 10 h-188 q-10 0 -10 -10z" fill="url(#shine)"/><rect x="110" y="92" width="180" height="16" fill="${lid}" fill-opacity="0.5"/><rect x="128" y="178" width="144" height="110" rx="12" fill="#fff" fill-opacity="0.94"/>${text(220, 28, initials, 700, c2)}${text(246, 12, brand, 600, "#1d1d1f", 0.85)}${text(270, 11, tag, 500, "#6e6e73")}`;
      break;
    case "bottle":
      body = `${shadow}<rect x="160" y="70" width="80" height="44" rx="8" fill="${lid}"/><rect x="128" y="108" width="144" height="242" rx="30" fill="url(#g)"/><rect x="128" y="108" width="144" height="242" rx="30" fill="url(#shine)"/><rect x="140" y="178" width="120" height="110" rx="12" fill="#fff" fill-opacity="0.94"/>${text(220, 26, initials, 700, c2)}${text(246, 11, brand, 600, "#1d1d1f", 0.85)}${text(268, 11, tag, 500, "#6e6e73")}`;
      break;
    case "serum":
      body = `${shadow}<rect x="182" y="58" width="36" height="58" rx="16" fill="${lid}"/><rect x="170" y="108" width="60" height="22" rx="6" fill="${lid}" fill-opacity="0.8"/><rect x="142" y="126" width="116" height="224" rx="22" fill="url(#g)" fill-opacity="0.92"/><rect x="142" y="126" width="116" height="224" rx="22" fill="url(#shine)"/><rect x="154" y="196" width="92" height="100" rx="10" fill="#fff" fill-opacity="0.94"/>${text(236, 22, initials, 700, c2)}${text(260, 10, brand, 600, "#1d1d1f", 0.85)}${text(280, 10, tag, 500, "#6e6e73")}`;
      break;
    case "headphones":
      body = `${shadow}<path d="M118 238 q0 -140 82 -140 q82 0 82 140" fill="none" stroke="${lid}" stroke-width="20" stroke-linecap="round"/><rect x="88" y="218" width="78" height="122" rx="36" fill="url(#g)"/><rect x="234" y="218" width="78" height="122" rx="36" fill="url(#g)"/><rect x="88" y="218" width="78" height="122" rx="36" fill="url(#shine)"/><rect x="234" y="218" width="78" height="122" rx="36" fill="url(#shine)"/>${text(284, 18, initials, 700, "#fff", 0.9)}`;
      break;
    default:
      body = `${shadow}<rect x="96" y="110" width="208" height="240" rx="20" fill="url(#g)"/>${text(240, 30, initials)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="Illustration of ${brand} ${label} (simulated demo product)">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.08"/></linearGradient>
<radialGradient id="bg" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1f1f3"/></radialGradient></defs>
<rect width="400" height="400" fill="url(#bg)"/>${body}
<text x="384" y="388" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#8e8e93">SIMULATED</text></svg>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const asin = file.replace(/\.svg$/, "").toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return new Response("Not found", { status: 404 });
  const hit = findDemoListing(asin);
  const body = hit
    ? svg(hit.family.shape, hit.family.hue, hit.family.brand, Object.values(hit.variant.attributes).join(" · ") || hit.variant.sizeText)
    : svg("box", hash32(asin) % 360, "Demo", asin);
  return new Response(body, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400, immutable", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}

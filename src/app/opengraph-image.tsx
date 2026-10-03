import { ImageResponse } from "next/og";
import { SITE } from "@/lib/config";
import { ENGINE_VERSION } from "@/lib/types";
import { VERDICT_BANDS } from "@/lib/engine/assay";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Open Graph card.
 *
 * Rendered at the edge with the same palette as the app. The factor strip is the
 * real published weight list, so the card cannot drift from the engine.
 */
export default async function OpenGraphImage() {
  const bands = VERDICT_BANDS;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0a1a1a",
          backgroundImage:
            "linear-gradient(to bottom, rgba(217,164,65,0.06) 1px, transparent 1px)",
          backgroundSize: "100% 34px",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              letterSpacing: 8,
              color: "#d9a441",
              textTransform: "uppercase",
            }}
          >
            MINTLINE
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 82,
              lineHeight: 1.05,
              color: "#e9e3d5",
              maxWidth: 940,
              fontWeight: 700,
            }}
          >
            Prove which Solana token came first.
          </div>
          <div
            style={{
              marginTop: 26,
              fontSize: 30,
              lineHeight: 1.4,
              color: "#b8b2a4",
              maxWidth: 900,
            }}
          >
            A hash-chained origin registry. On-chain metadata decoded, semantic collisions found with an
            open-weight model in your browser, every claim sealed and replayable.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(217,164,65,0.3)",
            paddingTop: 28,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {bands.map((band) => (
              <div key={band.verdict} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 132,
                    height: 8,
                    backgroundColor: "#d9a441",
                    opacity: band.min / 100,
                  }}
                />
                <div style={{ fontSize: 22, color: "#8b867a", letterSpacing: 1 }}>{band.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
            <div style={{ fontSize: 22, color: "#5f9e8f", letterSpacing: 1 }}>NO API KEY</div>
            <div style={{ fontSize: 22, color: "#8b867a", letterSpacing: 1 }}>{ENGINE_VERSION}</div>
            <div style={{ fontSize: 22, color: "#8b867a", letterSpacing: 1 }}>github.com/aniruddhaadak80/mintline</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
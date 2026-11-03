import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };
export const ogAlt = "Bhai Thik Kor - Expert AI Prompt Generator";

export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ width: 96, height: 8, background: "#10b981", marginBottom: 40 }} />
        <div style={{ fontSize: 96, fontWeight: 700, color: "#10b981" }}>
          Bhai Thik Kor
        </div>
        <div style={{ fontSize: 44, marginTop: 24, color: "#d4d4d8" }}>
          Turn a rough idea into an expert-grade execution prompt.
        </div>
      </div>
    ),
    { ...ogSize },
  );
}

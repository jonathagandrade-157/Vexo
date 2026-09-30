import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#7c3aed",
          borderRadius: 36,
          color: "white",
          display: "flex",
          fontFamily: "sans-serif",
          fontSize: 82,
          fontWeight: 700,
          height: "100%",
          justifyContent: "center",
          letterSpacing: -6,
          width: "100%",
        }}
      >
        <span
          style={{
            background: "white",
            height: 16,
            marginRight: 7,
            marginTop: -70,
            transform: "rotate(45deg)",
            width: 16,
          }}
        />
        <span style={{ marginLeft: -23, marginTop: 18 }}>V</span>
      </div>
    ),
    size,
  );
}

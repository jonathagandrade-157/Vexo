import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#7c3aed",
          color: "white",
          display: "flex",
          fontFamily: "sans-serif",
          fontSize: 230,
          fontWeight: 700,
          height: "100%",
          justifyContent: "center",
          letterSpacing: -18,
          width: "100%",
        }}
      >
        <span
          style={{
            background: "white",
            height: 44,
            marginRight: 18,
            marginTop: -196,
            transform: "rotate(45deg)",
            width: 44,
          }}
        />
        <span style={{ marginLeft: -62, marginTop: 54 }}>V</span>
      </div>
    ),
    size,
  );
}

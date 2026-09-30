import { ImageResponse } from "next/og";

export const alt = "VEXO — Sua loja online, do seu jeito";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0d0d14",
          color: "#f7f5ff",
          display: "flex",
          flexDirection: "column",
          fontFamily: "sans-serif",
          height: "100%",
          justifyContent: "space-between",
          overflow: "hidden",
          padding: "64px 72px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#6d28d9",
            borderRadius: 320,
            display: "flex",
            filter: "blur(90px)",
            height: 430,
            opacity: 0.5,
            position: "absolute",
            right: -110,
            top: -150,
            width: 430,
          }}
        />

        <div style={{ alignItems: "center", display: "flex", fontSize: 34, fontWeight: 700 }}>
          <span
            style={{
              background: "#a78bfa",
              height: 22,
              marginRight: 16,
              transform: "rotate(45deg)",
              width: 22,
            }}
          />
          VEXO
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
          <div style={{ color: "#c4b5fd", display: "flex", fontSize: 22, marginBottom: 22 }}>
            E-COMMERCE PARA OPERAR COM CLAREZA
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 72,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1.06,
            }}
          >
            <span>Sua loja online,</span>
            <span>do seu jeito.</span>
          </div>
          <div style={{ color: "#b8b5c5", display: "flex", fontSize: 27, lineHeight: 1.4, marginTop: 26 }}>
            Catálogo, pedidos, pagamentos e entrega em um único painel.
          </div>
        </div>

        <div style={{ color: "#8f8b9e", display: "flex", fontSize: 20 }}>
          Crie sua loja • Personalize • Publique • Venda
        </div>
      </div>
    ),
    size,
  );
}

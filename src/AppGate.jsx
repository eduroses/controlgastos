import React, { useEffect, useState } from "react";
import App from "./control-de-gastos-final.jsx";
import { supabase } from "./supabaseClient";
import { installReceiptOcrFetchInterceptor } from "./receiptOcr";

const FACE_ID_KEY = "controlgastos-passkey-enabled-v1";

export default function AppGate() {
  const [booting, setBooting] = useState(true);
  const [faceIdBusy, setFaceIdBusy] = useState(false);
  const [faceIdMessage, setFaceIdMessage] = useState("");
  const [offerFaceId, setOfferFaceId] = useState(false);

  useEffect(() => {
    // El escaneo de tickets funciona localmente en el teléfono, sin API paga.
    const cleanupOcr = installReceiptOcrFetchInterceptor();
    return cleanupOcr;
  }, []);

  useEffect(() => {
    let alive = true;

    async function lockCurrentSession() {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          await supabase.auth.signOut({ scope: "local" });
        }
      } catch (error) {
        console.error("No se pudo bloquear la sesión anterior:", error);
      } finally {
        if (alive) setBooting(false);
      }
    }

    lockCurrentSession();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user && !localStorage.getItem(FACE_ID_KEY)) {
        setOfferFaceId(true);
      }
    });

    return () => data?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (booting || !localStorage.getItem(FACE_ID_KEY)) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      setFaceIdBusy(true);
      setFaceIdMessage("");
      try {
        const { error } = await supabase.auth.signInWithPasskey();
        if (error) throw error;
      } catch (error) {
        console.warn("Face ID automático no disponible:", error);
        if (!cancelled) setFaceIdMessage("");
      } finally {
        if (!cancelled) setFaceIdBusy(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [booting]);

  const enableFaceId = async () => {
    setFaceIdBusy(true);
    setFaceIdMessage("");
    try {
      const { data: passkey, error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      localStorage.setItem(FACE_ID_KEY, "1");
      setOfferFaceId(false);
      console.log("Passkey registrada:", passkey?.id);
    } catch (error) {
      console.error("ERROR AL ACTIVAR FACE ID:", error);
      setFaceIdMessage(error?.message || "No se pudo activar Face ID. Verificá que Passkeys esté habilitado en Supabase y volvé a intentar.");
    } finally {
      setFaceIdBusy(false);
    }
  };

  if (booting) {
    return (
      <div style={styles.page}>
        <div style={styles.loading}>Protegiendo tu cuenta…</div>
      </div>
    );
  }

  return (
    <div className="app-safe-shell">
      <style>{`
        html, body, #root {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden !important;
          overscroll-behavior: none;
          background: #f6f7fb !important;
        }
        body {
          position: fixed;
          inset: 0;
          touch-action: manipulation;
        }
        .app-safe-shell {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          box-sizing: border-box;
          padding-top: max(34px, calc(env(safe-area-inset-top) + 14px));
          padding-bottom: env(safe-area-inset-bottom);
          overflow: hidden !important;
          overscroll-behavior: none;
          background: #f6f7fb !important;
        }
        .app-safe-shell > div {
          box-sizing: border-box;
          height: calc(100dvh - max(34px, calc(env(safe-area-inset-top) + 14px)) - env(safe-area-inset-bottom)) !important;
          min-height: 0 !important;
          overflow: hidden !important;
          border-radius: 22px 22px 0 0;
          background:
            radial-gradient(circle at 8% 0%, rgba(126,94,255,.18), transparent 26%),
            radial-gradient(circle at 95% 10%, rgba(67,170,255,.15), transparent 28%),
            linear-gradient(180deg, #eef0ff 0%, #f8f9fd 30%, #ffffff 68%, #f5f7fc 100%) !important;
          color: #20223a !important;
        }
        /* El contenido de la app queda debajo de la zona de estado del iPhone. */
        .app-safe-shell header,
        .app-safe-shell [role="banner"] {
          scroll-margin-top: 12px;
        }
        .app-safe-shell .fab {
          background: linear-gradient(135deg, #765cff 0%, #4b39df 100%) !important;
          box-shadow: 0 12px 30px rgba(91,70,235,.30) !important;
        }
        .app-safe-shell .primary-btn {
          background: linear-gradient(135deg, #765cff 0%, #4b39df 100%) !important;
          color: #fff !important;
          box-shadow: 0 10px 24px rgba(91,70,235,.20) !important;
        }
        .app-safe-shell input:focus,
        .app-safe-shell select:focus {
          border-color: #765cff !important;
          box-shadow: 0 0 0 3px rgba(118,92,255,.16) !important;
          outline: none !important;
        }
        .app-safe-shell .tap-target:active { transform: translateY(1px); }
        .app-safe-shell .fab:active { transform: scale(.94); }
      `}</style>

      <App />

      {offerFaceId && (
        <div style={styles.overlay}>
          <div style={styles.card}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🔐</div>
            <h2 style={styles.title}>Activá Face ID</h2>
            <p style={styles.text}>
              A partir de ahora la app te va a pedir autenticación cada vez que la abras. En este iPhone podés usar Face ID en lugar de escribir la contraseña.
            </p>
            {faceIdMessage && <p style={styles.error}>{faceIdMessage}</p>}
            <button onClick={enableFaceId} disabled={faceIdBusy} style={styles.primary}>
              {faceIdBusy ? "Activando…" : "Activar Face ID"}
            </button>
            <button onClick={() => setOfferFaceId(false)} style={styles.secondary}>Ahora no</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    background: "linear-gradient(180deg,#eef0ff 0%,#ffffff 70%,#f5f7fc 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#20223a",
    fontFamily: "Inter, sans-serif",
    padding: "24px",
  },
  loading: { color: "#5145df", fontSize: 14, fontWeight: 700 },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(30,32,60,.30)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "#ffffff",
    border: "1px solid rgba(118,92,255,.18)",
    borderRadius: 22,
    padding: 24,
    boxShadow: "0 20px 60px rgba(42,39,94,.20)",
    textAlign: "center",
  },
  title: { margin: "0 0 10px", color: "#24243a", fontFamily: "Sora, sans-serif", fontSize: 22 },
  text: { margin: "0 0 18px", color: "#666a80", fontFamily: "Inter, sans-serif", fontSize: 14, lineHeight: 1.55 },
  error: { color: "#D9485F", fontSize: 13, lineHeight: 1.45 },
  primary: {
    width: "100%",
    border: "none",
    borderRadius: 13,
    padding: "13px 16px",
    background: "linear-gradient(135deg,#765cff,#4b39df)",
    color: "#fff",
    fontWeight: 800,
    fontSize: 15,
  },
  secondary: { width: "100%", marginTop: 8, border: "none", background: "transparent", color: "#777b90", padding: 10, fontSize: 13 },
};

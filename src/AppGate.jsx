import React, { useEffect, useState } from "react";
import App from "./control-de-gastos-final.jsx";
import { supabase } from "./supabaseClient";

const FACE_ID_KEY = "controlgastos-passkey-enabled-v1";

export default function AppGate() {
  const [booting, setBooting] = useState(true);
  const [faceIdBusy, setFaceIdBusy] = useState(false);
  const [faceIdMessage, setFaceIdMessage] = useState("");
  const [offerFaceId, setOfferFaceId] = useState(false);

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

  // Si Face ID ya fue activado, intentamos iniciar sesión automáticamente
  // al abrir la app. Esto evita mostrar el antiguo botón flotante permanente.
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
        // Si el navegador no permite mostrar Face ID automáticamente,
        // dejamos disponible el login normal de la app sin agregar un
        // cartel flotante que tape la navegación.
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
        /* Espacio extra para Dynamic Island, cámara y barra de estado */
        .app-safe-shell {
          min-height: 100dvh;
          padding-top: max(18px, env(safe-area-inset-top));
          background: #f4f6fb;
        }
        .app-safe-shell > div {
          min-height: calc(100dvh - max(18px, env(safe-area-inset-top))) !important;
          background:
            radial-gradient(circle at 12% 2%, rgba(255,255,255,.22), transparent 24%),
            radial-gradient(circle at 92% 8%, rgba(88,74,245,.28), transparent 30%),
            linear-gradient(180deg, #6558f5 0%, #5145df 13%, #252447 28%, #11131d 54%, #0e1015 100%) !important;
        }
        /* Más vida en los elementos principales sin cambiar la funcionalidad */
        .app-safe-shell .fab {
          background: linear-gradient(135deg, #765cff 0%, #4b39df 100%) !important;
          box-shadow: 0 12px 30px rgba(91, 70, 235, .42) !important;
        }
        .app-safe-shell .primary-btn {
          background: linear-gradient(135deg, #765cff 0%, #4b39df 100%) !important;
          color: #fff !important;
          box-shadow: 0 10px 24px rgba(91, 70, 235, .28) !important;
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

      {/* Se eliminó el botón flotante permanente "Ingresar con Face ID".
          Cuando Face ID ya está configurado, la app intenta activarlo al abrir.
          Si iOS no permite el aviso automático, queda el login normal sin un
          elemento flotante tapando la navegación. */}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    background: "linear-gradient(180deg,#6558f5 0%,#252447 45%,#0E1015 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#F2F1EC",
    fontFamily: "Inter, sans-serif",
    padding: "24px",
  },
  loading: { color: "#fff", fontSize: 14, fontWeight: 600 },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(8,8,18,.72)",
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
    background: "linear-gradient(180deg,#20213a 0%,#171827 100%)",
    border: "1px solid rgba(146,129,255,.35)",
    borderRadius: 22,
    padding: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,.45)",
    textAlign: "center",
  },
  title: { margin: "0 0 10px", color: "#fff", fontFamily: "Sora, sans-serif", fontSize: 22 },
  text: { margin: "0 0 18px", color: "#B7BAD0", fontFamily: "Inter, sans-serif", fontSize: 14, lineHeight: 1.55 },
  error: { color: "#FF7D96", fontSize: 13, lineHeight: 1.45 },
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
  secondary: { width: "100%", marginTop: 8, border: "none", background: "transparent", color: "#9296AD", padding: 10, fontSize: 13 },
};

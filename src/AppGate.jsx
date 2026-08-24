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
        if (data?.session) await supabase.auth.signOut({ scope: "local" });
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

  const signInWithFaceId = async () => {
    setFaceIdBusy(true);
    setFaceIdMessage("");
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) throw error;
    } catch (error) {
      console.error("ERROR AL INICIAR CON FACE ID:", error);
      setFaceIdMessage(error?.message || "No se pudo usar Face ID. Si todavía no lo activaste, iniciá sesión con tu contraseña y activalo cuando aparezca la opción.");
    } finally {
      setFaceIdBusy(false);
    }
  };

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
    return <div style={styles.page}><div style={styles.loading}>Protegiendo tu cuenta…</div></div>;
  }

  return (
    <>
      <App />
      {offerFaceId && (
        <div style={styles.overlay}>
          <div style={styles.card}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🔐</div>
            <h2 style={styles.title}>Activá Face ID</h2>
            <p style={styles.text}>A partir de ahora la app te va a pedir autenticación cada vez que la abras. En este iPhone podés usar Face ID en lugar de escribir la contraseña.</p>
            {faceIdMessage && <p style={styles.error}>{faceIdMessage}</p>}
            <button onClick={enableFaceId} disabled={faceIdBusy} style={styles.primary}>{faceIdBusy ? "Activando…" : "Activar Face ID"}</button>
            <button onClick={() => setOfferFaceId(false)} style={styles.secondary}>Ahora no</button>
          </div>
        </div>
      )}
      {!offerFaceId && (
        <button onClick={signInWithFaceId} disabled={faceIdBusy} style={styles.faceButton} aria-label="Iniciar sesión con Face ID">
          <span style={{ fontSize: 22 }}>◉</span>{faceIdBusy ? "Comprobando…" : "Ingresar con Face ID"}
        </button>
      )}
    </>
  );
}

const styles = {
  page: { minHeight: "100dvh", background: "#0E1015", display: "flex", alignItems: "center", justifyContent: "center", color: "#F2F1EC", fontFamily: "Inter, sans-serif" },
  loading: { color: "#868C9B", fontSize: 14 },
  overlay: { position: "fixed", inset: 0, zIndex: 100, background: "rgba(5,6,9,.72)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, background: "#171A21", border: "1px solid #2A2E38", borderRadius: 22, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,.45)", textAlign: "center" },
  title: { margin: "0 0 10px", color: "#F2F1EC", fontFamily: "Sora, sans-serif", fontSize: 22 },
  text: { margin: "0 0 18px", color: "#A5AAB7", fontFamily: "Inter, sans-serif", fontSize: 14, lineHeight: 1.55 },
  error: { color: "#F2617A", fontSize: 13, lineHeight: 1.45 },
  primary: { width: "100%", border: "none", borderRadius: 13, padding: "13px 16px", background: "#D4A657", color: "#0E1015", fontWeight: 800, fontSize: 15 },
  secondary: { width: "100%", marginTop: 8, border: "none", background: "transparent", color: "#868C9B", padding: 10, fontSize: 13 },
  faceButton: { position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(22px + env(safe-area-inset-bottom))", zIndex: 90, border: "1px solid #4FC3E855", background: "rgba(31,35,44,.96)", color: "#F2F1EC", borderRadius: 14, padding: "11px 18px", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 10px 30px rgba(0,0,0,.3)" },
};

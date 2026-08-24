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
  const [accountEditor, setAccountEditor] = useState(null);
  const [accountEditorBusy, setAccountEditorBusy] = useState(false);

  useEffect(() => {
    const cleanupOcr = installReceiptOcrFetchInterceptor();
    return cleanupOcr;
  }, []);

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

  // Agrega un editor de cuentas sobre la pantalla existente sin romper el resto
  // de la aplicación. Al guardar se actualiza Supabase y se recarga la app para
  // que el estado local quede exactamente sincronizado con la base.
  useEffect(() => {
    if (booting) return;
    let cancelled = false;
    let observer;

    const installEditors = async () => {
      if (cancelled) return;
      const buttons = Array.from(document.querySelectorAll('button[aria-label^="Eliminar "]'));
      if (!buttons.length) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: accounts } = await supabase.from("accounts").select("*").eq("user_id", user.id);
      if (!accounts?.length) return;

      buttons.forEach((deleteButton) => {
        if (deleteButton.parentElement?.querySelector("[data-cg-edit-account]") ) return;
        const name = deleteButton.getAttribute("aria-label")?.replace(/^Eliminar\s+/, "").trim();
        const account = accounts.find((a) => a.name === name);
        if (!account) return;

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.setAttribute("data-cg-edit-account", account.id);
        editButton.setAttribute("aria-label", `Editar ${account.name}`);
        editButton.textContent = "✏️";
        editButton.style.cssText = "width:36px;height:36px;border-radius:10px;border:1px solid rgba(101,66,245,.2);background:rgba(101,66,245,.08);color:#6542F5;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;";
        editButton.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          setAccountEditor({
            id: account.id,
            name: account.name || "",
            currency: account.currency || "$",
            kind: account.kind || "debit",
            icon: account.icon || "💵",
            initialBalance: String(account.initial_balance ?? 0),
          });
        };
        deleteButton.parentElement?.insertBefore(editButton, deleteButton);
      });
    };

    installEditors();
    observer = new MutationObserver(() => installEditors());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [booting]);

  const saveAccountEdit = async () => {
    if (!accountEditor?.name?.trim()) return;
    setAccountEditorBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sesión no disponible");
      const { error } = await supabase.from("accounts").update({
        name: accountEditor.name.trim(),
        currency: accountEditor.currency || "$",
        kind: accountEditor.kind || "debit",
        icon: accountEditor.icon || "💵",
        initial_balance: Number(accountEditor.initialBalance) || 0,
      }).eq("id", accountEditor.id).eq("user_id", user.id);
      if (error) throw error;
      localStorage.removeItem("expense-tracker-state-v2");
      setAccountEditor(null);
      window.location.reload();
    } catch (error) {
      console.error("ERROR AL EDITAR CUENTA:", error);
      alert(error?.message || "No se pudo guardar la cuenta");
    } finally {
      setAccountEditorBusy(false);
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
          min-height: 100%;
          height: auto;
          margin: 0;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          overscroll-behavior-y: auto;
          background: #f6f7fb !important;
        }
        html {
          -webkit-text-size-adjust: 100%;
          overflow-y: auto !important;
        }
        body {
          position: relative;
          min-height: 100dvh;
          touch-action: pan-y;
          -webkit-overflow-scrolling: touch;
        }
        .app-safe-shell {
          position: relative;
          width: 100%;
          min-height: 100dvh;
          height: auto;
          box-sizing: border-box;
          padding-top: max(34px, calc(env(safe-area-inset-top) + 14px));
          padding-bottom: max(24px, env(safe-area-inset-bottom));
          overflow: visible !important;
          overflow-x: hidden !important;
          overflow-y: visible !important;
          overscroll-behavior: auto;
          background: #f6f7fb !important;
        }
        .app-safe-shell > div {
          box-sizing: border-box;
          height: auto !important;
          min-height: calc(100dvh - max(34px, calc(env(safe-area-inset-top) + 14px)) - env(safe-area-inset-bottom));
          overflow: visible !important;
          border-radius: 22px 22px 0 0;
          background:
            radial-gradient(circle at 8% 0%, rgba(126,94,255,.18), transparent 26%),
            radial-gradient(circle at 95% 10%, rgba(67,170,255,.15), transparent 28%),
            linear-gradient(180deg, #eef0ff 0%, #f8f9fd 30%, #ffffff 68%, #f5f7fc 100%) !important;
          color: #20223a !important;
        }
        .app-safe-shell header,
        .app-safe-shell [role="banner"] {
          scroll-margin-top: max(34px, calc(env(safe-area-inset-top) + 14px));
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
        .app-safe-shell [style*="88vh"] {
          max-height: 88dvh !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          -webkit-overflow-scrolling: touch !important;
          overscroll-behavior: contain !important;
          touch-action: pan-y !important;
        }
      `}</style>

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

      {accountEditor && (
        <div style={styles.overlay}>
          <div style={{ ...styles.card, textAlign: "left" }}>
            <h2 style={styles.title}>Editar cuenta</h2>
            <label style={styles.label}>Nombre</label>
            <input value={accountEditor.name} onChange={(e) => setAccountEditor({ ...accountEditor, name: e.target.value })} style={styles.input} />
            <label style={styles.label}>Saldo inicial / deuda inicial</label>
            <input type="number" inputMode="decimal" value={accountEditor.initialBalance} onChange={(e) => setAccountEditor({ ...accountEditor, initialBalance: e.target.value })} style={styles.input} />
            <label style={styles.label}>Moneda</label>
            <select value={accountEditor.currency} onChange={(e) => setAccountEditor({ ...accountEditor, currency: e.target.value })} style={styles.input}>
              <option value="$">Pesos ($)</option><option value="US$">Dólares (US$)</option><option value="€">Euros (€)</option><option value="R$">Reales (R$)</option>
            </select>
            <label style={styles.label}>Tipo</label>
            <select value={accountEditor.kind} onChange={(e) => setAccountEditor({ ...accountEditor, kind: e.target.value })} style={styles.input}>
              <option value="debit">Débito / efectivo</option><option value="credit">Tarjeta de crédito</option>
            </select>
            <label style={styles.label}>Ícono</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>{["👛","🏦","💳","💵","🐷","📱","🎯","✈️","🚗","🏡"].map((ic) => <button key={ic} onClick={() => setAccountEditor({ ...accountEditor, icon: ic })} style={{ width: 42, height: 42, borderRadius: 10, border: accountEditor.icon === ic ? "2px solid #6542F5" : "1px solid #E4E7F0", background: accountEditor.icon === ic ? "#F0EDFF" : "#fff", fontSize: 20 }}>{ic}</button>)}</div>
            <button onClick={saveAccountEdit} disabled={accountEditorBusy || !accountEditor.name.trim()} style={{ ...styles.primary, opacity: accountEditorBusy || !accountEditor.name.trim() ? .55 : 1 }}>{accountEditorBusy ? "Guardando…" : "Guardar cambios"}</button>
            <button onClick={() => setAccountEditor(null)} style={styles.secondary}>Cancelar</button>
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
    position: "fixed", inset: 0, zIndex: 100, background: "rgba(30,32,60,.30)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", overflowY: "auto", WebkitOverflowScrolling: "touch"
  },
  card: {
    width: "100%", maxWidth: 420, background: "#ffffff", border: "1px solid rgba(118,92,255,.18)", borderRadius: 22, padding: 24, boxShadow: "0 20px 60px rgba(42,39,94,.20)", textAlign: "center", maxHeight: "calc(100dvh - 48px)", overflowY: "auto"
  },
  title: { margin: "0 0 10px", color: "#24243a", fontFamily: "Sora, sans-serif", fontSize: 22 },
  text: { margin: "0 0 18px", color: "#666a80", fontFamily: "Inter, sans-serif", fontSize: 14, lineHeight: 1.55 },
  error: { color: "#D9485F", fontSize: 13, lineHeight: 1.45 },
  label: { display: "block", margin: "12px 0 6px", color: "#172554", fontSize: 13, fontWeight: 700 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #D9DDEA", borderRadius: 12, padding: "12px 13px", background: "#fff", color: "#172554", fontSize: 15, outline: "none" },
  primary: { width: "100%", border: "none", borderRadius: 13, padding: "13px 16px", background: "linear-gradient(135deg,#765cff,#4b39df)", color: "#fff", fontWeight: 800, fontSize: 15 },
  secondary: { width: "100%", marginTop: 8, border: "none", background: "transparent", color: "#777b90", padding: 10, fontSize: 13 },
};

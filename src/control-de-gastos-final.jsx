import { supabase } from "./supabaseClient";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { createWorker } from "tesseract.js";
import {
  Home as HomeIcon,
  List,
  Target,
  Wallet,
  Plus,
  X,
  Search,
  Settings as SettingsIcon,
  Repeat,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
  Camera,
  CreditCard,
  Loader2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */
const T = {
  // Paleta clara inspirada en el diseño de referencia.
  bg: "#F7F8FC",
  surface: "#FFFFFF",
  surface2: "#F5F3FF",
  surface3: "#E9EAF2",
  border: "#E4E7F0",
  gold: "#6542F5",
  goldSoft: "rgba(101,66,245,0.10)",
  income: "#24B15A",
  incomeSoft: "rgba(36,177,90,0.10)",
  expense: "#F04444",
  expenseSoft: "rgba(240,68,68,0.10)",
  text: "#172554",
  textMuted: "#64748B",
  textFaint: "#94A3B8",
};

const STORAGE_KEY = "expense-tracker-state-v2";
const CURRENCY_OPTIONS = ["$", "US$", "otra"];

const DEFAULT_EXPENSE_CATEGORIES = [
  { id: "c-food", name: "Comida", icon: "🍔", color: "#F2617A", type: "expense" },
  { id: "c-transport", name: "Transporte", icon: "🚌", color: "#5FA8F5", type: "expense" },
  { id: "c-home", name: "Vivienda", icon: "🏠", color: "#B18CF0", type: "expense" },
  { id: "c-leisure", name: "Ocio", icon: "🎮", color: "#F5B942", type: "expense" },
  { id: "c-health", name: "Salud", icon: "⚕️", color: "#3DDC97", type: "expense" },
  { id: "c-shopping", name: "Compras", icon: "🛍️", color: "#F582B9", type: "expense" },
  { id: "c-bills", name: "Servicios", icon: "💡", color: "#4FC3E8", type: "expense" },
  { id: "c-other-exp", name: "Otros", icon: "📦", color: "#9AA1B0", type: "expense" },
];

const DEFAULT_INCOME_CATEGORIES = [
  { id: "c-salary", name: "Sueldo", icon: "💼", color: "#3DDC97", type: "income" },
  { id: "c-freelance", name: "Freelance", icon: "💻", color: "#4FE0B0", type: "income" },
  { id: "c-gift", name: "Regalo", icon: "🎁", color: "#F5B942", type: "income" },
  { id: "c-other-inc", name: "Otros", icon: "💰", color: "#4FC3E8", type: "income" },
  { id: "c-payment", name: "Pago de tarjeta", icon: "💳", color: "#5FA8F5", type: "income" },
];

const ICONS_POOL = ["👛", "🏦", "💳", "💵", "🐷", "📱", "🎯", "✈️", "🚗", "🏡"];

function uid(prefix = "id") {
  // Supabase usa UUID para los IDs persistidos.
  // Para movimientos y cuentas devolvemos UUID reales; para claves internas
  // (si alguna otra parte las usa) mantenemos el formato anterior.
  if (prefix === "t" || prefix === "a") {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isUUID(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}
function budgetKey(catId, cur) {
  return `${catId}__${cur}`;
}
function fmtMoney(n, currency, compact = false) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const str = abs.toLocaleString("es-UY", {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  });
  return `${sign}${currency} ${str}`;
}
function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Hoy";
  if (sameDay(d, yest)) return "Ayer";
  return d.toLocaleDateString("es-UY", { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString("es-UY", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */
function defaultState() {
  return {
    onboarded: false,
    accounts: [{ id: "a-cash", name: "Efectivo", icon: "💵", color: "#D4A657", kind: "debit", currency: "$", initialBalance: 0 }],
    categories: [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES],
    transactions: [],
    budgets: {},
    recurring: [],
  };
}

async function loadState() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const saved = localStorage.getItem(STORAGE_KEY);
    const localState = saved ? JSON.parse(saved) : defaultState();

    if (!user) return { ...defaultState(), ...localState };

    // Cargamos las cuentas de Supabase. Los IDs de cuentas son compatibles
    // con los IDs que ya usa la app, así que no los transformamos acá.
    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", user.id);

    if (accountsError) throw accountsError;

    const mappedAccounts = (accounts || []).map((account) => ({
      id: account.id,
      name: account.name,
      icon: account.icon || "💵",
      color: account.color || "#6542F5",
      kind: account.kind || "debit",
      currency: account.currency || "$",
      initialBalance: Number(account.initial_balance || 0),
    }));

    let remoteTransactions = [];
    const { data: transactions, error: txError } = await supabase
      .from("transactions")
      .select("id,user_id,account_id,type,description,amount,category_id,date")
      .eq("user_id", user.id);

    if (!txError) {
      remoteTransactions = (transactions || []).map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount || 0),
        accountId: tx.account_id,
        categoryId: tx.category_id || "",
        date: tx.date,
        note: tx.description || "",
      }));
    } else {
      console.error("ERROR SUPABASE AL CARGAR MOVIMIENTOS:", txError);
    }

    const finalAccounts = mappedAccounts.length ? mappedAccounts : (localState.accounts || defaultState().accounts);
    const localTxs = (localState.transactions || []).map((tx) => ({
      ...tx,
      id: isUUID(tx.id) ? tx.id : uid("t"),
    }));
    const finalTransactions = remoteTransactions.length ? remoteTransactions : localTxs;

    const result = {
      ...defaultState(),
      ...localState,
      accounts: finalAccounts,
      transactions: finalTransactions,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    return result;
  } catch (e) {
    console.error("No se pudo cargar", e);
  }

  return defaultState();
}

async function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // IMPORTANTE: sincronizamos en ambos sentidos. Antes solo hacíamos upsert,
    // por lo que un registro eliminado de la app seguía vivo en Supabase y
    // volvía a aparecer al reiniciar.
    const remoteAccountsRes = await supabase.from("accounts").select("id").eq("user_id", user.id);
    const remoteTransactionsRes = await supabase.from("transactions").select("id").eq("user_id", user.id);

    const remoteAccountIds = (remoteAccountsRes.data || []).map((x) => x.id);
    const remoteTransactionIds = (remoteTransactionsRes.data || []).map((x) => x.id);
    const localAccountIds = new Set((state.accounts || []).map((a) => a.id));
    const localTransactionIds = new Set((state.transactions || []).filter((t) => isUUID(t.id)).map((t) => t.id));

    const accountIdsToDelete = remoteAccountIds.filter((id) => !localAccountIds.has(id));
    if (accountIdsToDelete.length) {
      const { error } = await supabase.from("accounts").delete().eq("user_id", user.id).in("id", accountIdsToDelete);
      if (error) console.error("ERROR SUPABASE AL ELIMINAR CUENTAS:", error);
    }

    const transactionIdsToDelete = remoteTransactionIds.filter((id) => !localTransactionIds.has(id));
    if (transactionIdsToDelete.length) {
      const { error } = await supabase.from("transactions").delete().eq("user_id", user.id).in("id", transactionIdsToDelete);
      if (error) console.error("ERROR SUPABASE AL ELIMINAR MOVIMIENTOS:", error);
    }

    for (const account of state.accounts || []) {
      const accountId = account.id || uid("a");
      const payload = {
        id: accountId,
        user_id: user.id,
        name: account.name,
        currency: account.currency || "$",
        initial_balance: Number(account.initialBalance || 0),
        icon: account.icon || "💵",
        color: account.color || "#6542F5",
        kind: account.kind || "debit",
      };
      const { error } = await supabase.from("accounts").upsert(payload);
      if (error) console.error("ERROR SUPABASE AL GUARDAR CUENTA:", error);
    }

    for (const tx of state.transactions || []) {
      const txId = isUUID(tx.id) ? tx.id : uid("t");
      const payload = {
        id: txId,
        user_id: user.id,
        account_id: tx.accountId,
        type: tx.type,
        description: (tx.note || "Movimiento").trim() || "Movimiento",
        amount: Number(tx.amount || 0),
        category_id: tx.categoryId || null,
        date: tx.date || todayISO(),
      };
      const { error } = await supabase.from("transactions").upsert(payload);
      if (error) console.error("ERROR SUPABASE AL GUARDAR MOVIMIENTO:", error);
    }
  } catch (e) {
    console.error("No se pudo guardar", e);
  }
}
/* ------------------------------------------------------------------ */
/*  Receipt scanning via Claude                                        */
/* ------------------------------------------------------------------ */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

async function scanReceiptImage({ base64, mediaType, categories, currencies }) {
  const worker = await createWorker("spa+eng");
  try {
    const image = `data:${mediaType || "image/jpeg"};base64,${base64}`;
    const { data } = await worker.recognize(image);
    const text = (data?.text || "").replace(/\r/g, "");
    const normalized = text.replace(/\s+/g, " ").trim();

    const amountCandidates = [];
    const amountRegex = /(?:total(?:\s+a\s+pagar)?|importe|monto|pagar|pagado|\btotal\b)[^0-9$€£]{0,20}(?:[$€£]|US\$|U\$S|USD)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)/gi;
    let match;
    while ((match = amountRegex.exec(normalized))) amountCandidates.push(match[1]);

    if (!amountCandidates.length) {
      const generic = /(?:[$€£]|US\$|U\$S|USD)?\s*([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})/g;
      while ((match = generic.exec(normalized))) amountCandidates.push(match[1]);
    }

    const parseAmount = (raw) => {
      if (!raw) return 0;
      let v = raw.replace(/[^0-9.,]/g, "");
      if (v.includes(",") && v.includes(".")) {
        if (v.lastIndexOf(",") > v.lastIndexOf(".")) v = v.replace(/\./g, "").replace(",", ".");
        else v = v.replace(/,/g, "");
      } else if (v.includes(",")) {
        const parts = v.split(",");
        v = parts.length === 2 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : v.replace(/,/g, "");
      } else if (v.includes(".")) {
        const parts = v.split(".");
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) v = v.replace(/\./g, "");
      }
      return Number(v) || 0;
    };

    const amount = amountCandidates.map(parseAmount).filter((n) => n > 0).sort((a, b) => b - a)[0] || 0;
    const upper = normalized.toUpperCase();
    const currency = /(?:USD|U\$S|US\$|DÓLAR|DOLAR)/.test(upper) ? "US$" : currencies[0] || "$";
    const lower = normalized.toLowerCase();
    const categoryRules = [
      ["c-food", /(supermercado|almac[eé]n|comida|restaurant|restaurante|carnicer[ií]a|panader[ií]a)/],
      ["c-transport", /(nafta|combustible|estaci[oó]n|taxi|uber|cabify|ómnibus|omnibus|transporte)/],
      ["c-bills", /(luz|ute|ose|antel|internet|telefon[ií]a|agua|servicio)/],
      ["c-health", /(farmacia|medicamento|hospital|m[eé]dico|salud)/],
      ["c-shopping", /(shopping|ropa|zapater[ií]a|compras|tienda)/],
      ["c-home", /(alquiler|vivienda|hogar|ferreter[ií]a)/],
      ["c-leisure", /(cine|juego|entretenimiento|bar|ocio)/],
    ];
    let categoryId = categories.find((c) => c.id === "c-other-exp")?.id || categories[0]?.id || "";
    for (const [id, rule] of categoryRules) {
      if (rule.test(lower) && categories.some((c) => c.id === id)) { categoryId = id; break; }
    }

    const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
    const merchant = lines.find((line) => line.length >= 3 && !/total|importe|iva|rut|fecha|hora|tel[eé]fono|domicilio/i.test(line))?.slice(0, 60) || "";
    const note = merchant ? merchant : "Compra desde ticket";

    if (!amount) throw new Error("No se pudo detectar un importe en el ticket");
    return { amount, currency, categoryId, merchant, note };
  } finally {
    await worker.terminate();
  }
}

/* ------------------------------------------------------------------ */
/*  Small UI primitives                                                */
/* ------------------------------------------------------------------ */
function IconBadge({ icon, color, size = 40 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: `${color}22`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.5,
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
  );
}

function Ring({ pct, color, size = 44, stroke = 5 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(pct, 1));
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.surface3} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={pct > 1 ? T.expense : color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped)}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset .5s ease" }}
      />
    </svg>
  );
}

function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(23,37,84,0.18)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-end",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.surface,
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
          borderRadius: "22px 22px 0 0",
          maxHeight: "88vh",
          overflowY: "auto",
          border: `1px solid ${T.border}`,
          borderBottom: "none",
          paddingBottom: "env(safe-area-inset-bottom)",
          boxShadow: "0 -12px 40px rgba(23,37,84,0.12)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 4, background: T.textFaint }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px 4px" }}>
          <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>{title}</h2>
          <button onClick={onClose} className="tap-target" style={{ color: T.textMuted, background: "none", border: "none" }}>
            <X size={22} />
          </button>
        </div>
        <div style={{ padding: "8px 20px 28px" }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12.5, color: T.textMuted, fontFamily: "Inter, sans-serif", display: "block", marginBottom: 7 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: T.surface2,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: "12px 14px",
  color: T.text,
  fontSize: 15,
  fontFamily: "Inter, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

function Pill({ active, onClick, children, color }) {
  return (
    <button
      onClick={onClick}
      className="tap-target"
      style={{
        padding: "8px 13px",
        borderRadius: 11,
        border: `1px solid ${active ? color || T.gold : T.border}`,
        background: active ? `${color || T.gold}22` : T.surface2,
        color: active ? T.text : T.textMuted,
        fontFamily: "Inter, sans-serif",
        fontSize: 13.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Onboarding                                                         */
/* ------------------------------------------------------------------ */
function Onboarding({ onDone }) {
  const [currency, setCurrency] = useState("$");
  const [customCurrency, setCustomCurrency] = useState("");
  const [accountName, setAccountName] = useState("Efectivo");
  const [balance, setBalance] = useState("");

  const finish = () => {
    const cur = currency === "otra" ? customCurrency.trim() || "$" : currency;
    onDone({
      accounts: [
        { id: "a-cash", name: accountName.trim() || "Efectivo", icon: "💵", color: "#6542F5", kind: "debit", currency: cur, initialBalance: Number(balance) || 0 },
      ],
    });
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: T.bg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px)",
      }}
    >
      <div style={{ maxWidth: 420, margin: "0 auto", width: "100%" }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🪙</div>
        <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 800, color: T.text, margin: "0 0 6px" }}>
          Control de Gastos
        </h1>
        <p style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 14.5, margin: "0 0 32px", lineHeight: 1.5 }}>
          Manejá pesos, dólares y tarjetas de crédito, todo en un solo lugar. Después vas a poder agregar más cuentas.
        </p>

        <Field label="Nombrá tu primera cuenta">
          <input style={inputStyle} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Ej: Efectivo, Banco" />
        </Field>

        <Field label="¿En qué moneda es esta cuenta?">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[{ v: "$", l: "Pesos ($)" }, { v: "US$", l: "Dólares (US$)" }, { v: "otra", l: "Otra" }].map((o) => (
              <Pill key={o.v} active={currency === o.v} onClick={() => setCurrency(o.v)}>
                {o.l}
              </Pill>
            ))}
          </div>
          {currency === "otra" && (
            <input style={{ ...inputStyle, marginTop: 10 }} placeholder="Símbolo, ej: R$, €" value={customCurrency} onChange={(e) => setCustomCurrency(e.target.value)} />
          )}
        </Field>

        <Field label={`Saldo inicial`}>
          <input style={inputStyle} type="number" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
        </Field>

        <button onClick={finish} className="tap-target primary-btn" style={{ width: "100%", marginTop: 8 }}>
          Empezar
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quick Add Sheet                                                    */
/* ------------------------------------------------------------------ */
function QuickAddSheet({ open, onClose, state, onSave, onDelete, editing }) {
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(state.accounts[0]?.id);
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [scanStatus, setScanStatus] = useState("idle");
  const [scanLabel, setScanLabel] = useState("");
  const amountRef = useRef(null);
  const fileInputRef = useRef(null);

  const currenciesInUse = useMemo(() => Array.from(new Set(state.accounts.map((a) => a.currency))), [state.accounts]);

  useEffect(() => {
    if (open) {
      setScanStatus("idle");
      setScanLabel("");
      if (editing) {
        setType(editing.type);
        setAmount(String(editing.amount));
        setAccountId(editing.accountId);
        setCategoryId(editing.categoryId);
        setDate(editing.date);
        setNote(editing.note || "");
      } else {
        setType("expense");
        setAmount("");
        setAccountId(state.accounts[0]?.id);
        setCategoryId("");
        setDate(todayISO());
        setNote("");
      }
      setTimeout(() => amountRef.current?.focus(), 150);
    }
  }, [open, editing]);

  const selectedAccount = state.accounts.find((a) => a.id === accountId) || state.accounts[0];
  const isCredit = selectedAccount?.kind === "credit";
  const cats = state.categories.filter((c) => c.type === type);

  useEffect(() => {
    if (!editing && cats.length && !cats.find((c) => c.id === categoryId)) setCategoryId(cats[0].id);
    // eslint-disable-next-line
  }, [type]);

  const canSave = Number(amount) > 0 && accountId && categoryId;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setScanStatus("scanning");
    try {
      const base64 = await fileToBase64(file);
      const expenseCats = state.categories.filter((c) => c.type === "expense");
      const currencies = currenciesInUse.length ? currenciesInUse : ["$"];
      const result = await scanReceiptImage({ base64, mediaType: file.type || "image/jpeg", categories: expenseCats, currencies });

      setType("expense");
      if (result.amount) setAmount(String(result.amount));
      if (result.categoryId && expenseCats.find((c) => c.id === result.categoryId)) setCategoryId(result.categoryId);
      if (result.currency) {
        const match = state.accounts.find((a) => a.currency === result.currency && a.kind === "debit") || state.accounts.find((a) => a.currency === result.currency);
        if (match) setAccountId(match.id);
      }
      const label = result.merchant || result.note || "Ticket";
      setNote(result.merchant ? result.merchant : result.note || "");
      setScanLabel(label);
      setScanStatus("done");
    } catch (err) {
      console.error(err);
      setScanStatus("error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Editar movimiento" : "Nuevo movimiento"}>
      {!editing && (
        <div style={{ marginBottom: 18 }}>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFile} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={scanStatus === "scanning"}
            className="tap-target"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "12px 0",
              borderRadius: 13,
              border: `1.5px dashed ${T.gold}66`,
              background: T.goldSoft,
              color: T.gold,
              fontFamily: "Inter, sans-serif",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {scanStatus === "scanning" ? (
              <>
                <Loader2 size={17} className="spin" /> Leyendo el ticket…
              </>
            ) : (
              <>
                <Camera size={17} /> Escanear ticket con la cámara
              </>
            )}
          </button>
          {scanStatus === "done" && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: T.income, fontFamily: "Inter, sans-serif" }}>
              ✓ Detectamos "{scanLabel}" — revisá los datos antes de guardar
            </div>
          )}
          {scanStatus === "error" && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: T.expense, fontFamily: "Inter, sans-serif" }}>
              No pudimos leer el ticket. Completá los datos a mano.
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", background: T.surface2, borderRadius: 12, padding: 4, marginBottom: 18 }}>
        {(isCredit
          ? [{ v: "expense", l: "Compra", c: T.expense }, { v: "income", l: "Pago", c: T.income }]
          : [{ v: "expense", l: "Gasto", c: T.expense }, { v: "income", l: "Ingreso", c: T.income }]
        ).map((o) => (
          <button
            key={o.v}
            onClick={() => setType(o.v)}
            className="tap-target"
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9,
              border: "none",
              background: type === o.v ? o.c : "transparent",
              color: type === o.v ? "#FFFFFF" : T.textMuted,
              fontFamily: "Inter, sans-serif",
              fontWeight: 700,
              fontSize: 14,
              transition: "all .2s",
            }}
          >
            {o.l}
          </button>
        ))}
      </div>
      {isCredit && (
        <div style={{ marginTop: -12, marginBottom: 16, color: T.textMuted, fontSize: 12, fontFamily: "Inter, sans-serif" }}>
          Es una tarjeta de crédito: las compras suman a la deuda, los pagos la descuentan.
        </div>
      )}

      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 4, fontFamily: "Inter, sans-serif" }}>
          Monto ({selectedAccount?.currency || "$"})
        </div>
        <input
          ref={amountRef}
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="amount-input"
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: type === "expense" ? T.expense : T.income,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 40,
            fontWeight: 600,
            textAlign: "center",
            width: "100%",
          }}
        />
      </div>

      <Field label="Categoría">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {cats.map((c) => (
            <Pill key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)} color={c.color}>
              {c.icon} {c.name}
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Cuenta">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {state.accounts.map((a) => (
            <Pill key={a.id} active={accountId === a.id} onClick={() => setAccountId(a.id)}>
              {a.icon} {a.name} · {a.currency}
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Fecha">
        <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <Field label="Nota (opcional)">
        <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Supermercado del sábado" />
      </Field>

      <button
        disabled={!canSave}
        onClick={() =>
          onSave({
            id: editing?.id || uid("t"),
            type,
            amount: Number(amount),
            accountId,
            categoryId,
            date,
            note: note.trim(),
          })
        }
        className="tap-target primary-btn"
        style={{ width: "100%", opacity: canSave ? 1 : 0.4, marginTop: 4 }}
      >
        {editing ? "Guardar cambios" : "Registrar movimiento"}
      </button>

      {editing && (
        <button
          onClick={() => onDelete(editing.id)}
          className="tap-target"
          style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 13, padding: "8px 0" }}
        >
          Eliminar movimiento
        </button>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Balance logic                                                      */
/* ------------------------------------------------------------------ */
function computeBalances(state) {
  const byAccount = {};
  state.accounts.forEach((a) => (byAccount[a.id] = a.initialBalance || 0));
  state.transactions.forEach((t) => {
    const acc = state.accounts.find((a) => a.id === t.accountId);
    if (!acc) return;
    const isDebit = acc.kind !== "credit";
    let delta;
    if (isDebit) delta = t.type === "income" ? t.amount : -t.amount;
    else delta = t.type === "expense" ? t.amount : -t.amount;
    byAccount[t.accountId] = (byAccount[t.accountId] || 0) + delta;
  });
  return byAccount;
}

function TxRow({ t, category, account, onClick }) {
  const isIncome = t.type === "income";
  const isCredit = account?.kind === "credit";
  const positive = isCredit ? !isIncome : isIncome;
  return (
    <button onClick={onClick} className="tap-target tx-row" style={{ width: "100%", background: "none", border: "none", padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 4px" }}>
        <IconBadge icon={category?.icon || "•"} color={category?.color || T.textMuted} size={40} />
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div style={{ color: T.text, fontFamily: "Inter, sans-serif", fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {category?.name || "Sin categoría"}
          </div>
          <div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {account?.icon} {account?.name}{account?.kind === "credit" ? " · crédito" : ""}{t.note ? ` · ${t.note}` : ""}
          </div>
        </div>
        <div
          style={{
            color: isIncome ? T.income : T.text,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 14.5,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {isIncome ? "+" : "-"}{fmtMoney(t.amount, account?.currency || "$")}
        </div>
      </div>
    </button>
  );
}

function Donut({ segments, size = 150 }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return (
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 8} fill="none" stroke={T.surface3} strokeWidth={16} />
      </svg>
    );
  }
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.surface3} strokeWidth={16} />
      {segments.map((s, i) => {
        const frac = s.value / total;
        const dash = frac * c;
        const el = (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={16} strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} strokeLinecap="butt" />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Home                                                                */
/* ------------------------------------------------------------------ */
function HomeView({ state, onEditTx, dueRecurring, onProcessRecurring }) {
  const currencies = useMemo(() => Array.from(new Set(state.accounts.map((a) => a.currency))), [state.accounts]);
  const [viewCur, setViewCur] = useState(currencies[0]);
  useEffect(() => {
    if (!currencies.includes(viewCur)) setViewCur(currencies[0]);
  }, [currencies.join(",")]);

  const balances = computeBalances(state);
  const mKey = monthKey(todayISO());
  const currencySummaries = currencies.map((cur) => {
    const accs = state.accounts.filter((a) => a.currency === cur);
    const debit = accs.filter((a) => a.kind !== "credit");
    const credit = accs.filter((a) => a.kind === "credit");
    const available = debit.reduce((s, a) => s + (balances[a.id] || 0), 0);
    const debt = credit.reduce((s, a) => s + (balances[a.id] || 0), 0);
    const monthTxCur = state.transactions.filter((t) => monthKey(t.date) === mKey && state.accounts.find((a) => a.id === t.accountId)?.currency === cur);
    const income = monthTxCur.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = monthTxCur.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { cur, available, debt, income, expense, hasCredit: credit.length > 0 };
  });
  const monthTx = state.transactions.filter((t) => monthKey(t.date) === mKey && state.accounts.find((a) => a.id === t.accountId)?.currency === viewCur);
  const viewExpense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const byCat = {};
  monthTx.filter((t) => t.type === "expense").forEach((t) => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount; });
  const segments = Object.entries(byCat).map(([id, value]) => ({ value, color: state.categories.find((c) => c.id === id)?.color || T.textMuted, id })).sort((a, b) => b.value - a.value);
  const topCats = segments.slice(0, 5).map((s) => ({ ...s, cat: state.categories.find((c) => c.id === s.id) }));
  const recent = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const overBudgetCats = Object.entries(state.budgets).map(([key, limit]) => {
    const [catId, cur] = key.split("__");
    const spentTx = state.transactions.filter((t) => t.type === "expense" && t.categoryId === catId && monthKey(t.date) === mKey && state.accounts.find((a) => a.id === t.accountId)?.currency === cur);
    const spent = spentTx.reduce((s, t) => s + t.amount, 0);
    return { catId, cur, limit, spent, pct: limit > 0 ? spent / limit : 0, cat: state.categories.find((c) => c.id === catId) };
  }).filter((b) => b.limit > 0 && b.pct >= 0.8).sort((a, b) => b.pct - a.pct);

  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 18, marginBottom: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        {currencySummaries.map((s) => (
          <div key={s.cur} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 18, boxShadow: "0 6px 22px rgba(23,37,84,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 13 }}>Disponible · {s.cur}</div>
                <div style={{ color: T.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 30, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{fmtMoney(s.available, s.cur)}</div>
              </div>
              {s.hasCredit && <div style={{ textAlign: "right" }}><div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 11.5, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}><CreditCard size={12} /> Debés</div><div style={{ color: T.expense, fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 600, marginTop: 2 }}>{fmtMoney(s.debt, s.cur)}</div></div>}
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><ArrowDownLeft size={15} color={T.income} /><span style={{ color: T.income, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5 }}>{fmtMoney(s.income, s.cur, true)}</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><ArrowUpRight size={15} color={T.expense} /><span style={{ color: T.expense, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5 }}>{fmtMoney(s.expense, s.cur, true)}</span></div>
            </div>
          </div>
        ))}
      </div>
      {dueRecurring.length > 0 && <div style={{ background: T.goldSoft, border: `1px solid ${T.gold}55`, borderRadius: 14, padding: "12px 14px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}><Repeat size={18} color={T.gold} style={{ flexShrink: 0 }} /><div style={{ flex: 1, color: T.text, fontFamily: "Inter, sans-serif", fontSize: 13 }}>Tenés {dueRecurring.length} {dueRecurring.length === 1 ? "movimiento recurrente" : "movimientos recurrentes"} pendiente{dueRecurring.length === 1 ? "" : "s"}</div><button onClick={onProcessRecurring} className="tap-target" style={{ background: T.gold, color: "#FFFFFF", border: "none", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "Inter, sans-serif", flexShrink: 0 }}>Registrar</button></div>}
      {overBudgetCats.length > 0 && <div style={{ marginBottom: 18 }}>{overBudgetCats.map((b) => <div key={b.catId + b.cur} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: b.pct >= 1 ? T.expenseSoft : T.goldSoft, borderRadius: 12, marginBottom: 8 }}><span style={{ fontSize: 16 }}>{b.cat?.icon}</span><span style={{ flex: 1, color: T.text, fontFamily: "Inter, sans-serif", fontSize: 13 }}>{b.pct >= 1 ? `Superaste el presupuesto de ${b.cat?.name}` : `Estás cerca del límite en ${b.cat?.name}`} ({b.cur})</span><span style={{ color: b.pct >= 1 ? T.expense : T.gold, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 700 }}>{Math.round(b.pct * 100)}%</span></div>)}</div>}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 20, marginBottom: 20, boxShadow: "0 6px 22px rgba(23,37,84,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}><span style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, color: T.text, fontSize: 15 }}>Gastos de {monthLabel(mKey)}</span>{currencies.length > 1 && <div style={{ display: "flex", gap: 6 }}>{currencies.map((c) => <Pill key={c} active={viewCur === c} onClick={() => setViewCur(c)}>{c}</Pill>)}</div>}</div>
        {segments.length === 0 ? <div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 13.5, textAlign: "center", padding: "20px 0" }}>Todavía no registraste gastos en {viewCur} este mes</div> : <div style={{ display: "flex", alignItems: "center", gap: 22 }}><Donut segments={segments} /><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>{topCats.map((s) => <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: 4, background: s.color, flexShrink: 0 }} /><span style={{ flex: 1, color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 12.5 }}>{s.cat?.icon} {s.cat?.name}</span><span style={{ color: T.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{Math.round((s.value / (viewExpense || 1)) * 100)}%</span></div>)}</div></div>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><span style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, color: T.text, fontSize: 15 }}>Movimientos recientes</span></div>
      {recent.length === 0 ? <div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 13.5, textAlign: "center", padding: "30px 0" }}>Tocá el botón + para registrar tu primer movimiento</div> : <div>{recent.map((t) => <TxRow key={t.id} t={t} category={state.categories.find((c) => c.id === t.categoryId)} account={state.accounts.find((a) => a.id === t.accountId)} onClick={() => onEditTx(t)} />)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History                                                             */
/* ------------------------------------------------------------------ */
function HistoryView({ state, onEditTx }) {
  const [query, setQuery] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterAcc, setFilterAcc] = useState("all");
  const filtered = state.transactions.filter((t) => (filterCat === "all" ? true : t.categoryId === filterCat)).filter((t) => (filterAcc === "all" ? true : t.accountId === filterAcc)).filter((t) => { if (!query.trim()) return true; const cat = state.categories.find((c) => c.id === t.categoryId); const hay = `${cat?.name || ""} ${t.note || ""}`.toLowerCase(); return hay.includes(query.toLowerCase()); }).sort((a, b) => (a.date < b.date ? 1 : -1));
  const groups = {};
  filtered.forEach((t) => { groups[t.date] = groups[t.date] || []; groups[t.date].push(t); });
  return (
    <div style={{ padding: "0 20px 100px" }}>
      <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 800, color: T.text, margin: "18px 0 16px" }}>Historial</h1>
      <div style={{ position: "relative", marginBottom: 12 }}><Search size={16} color={T.textMuted} style={{ position: "absolute", left: 14, top: 13 }} /><input style={{ ...inputStyle, paddingLeft: 38 }} placeholder="Buscar por categoría o nota" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 16 }} className="no-scrollbar"><select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "8px 10px", fontSize: 13 }}><option value="all">Todas las categorías</option>{state.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select><select value={filterAcc} onChange={(e) => setFilterAcc(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "8px 10px", fontSize: 13 }}><option value="all">Todas las cuentas</option>{state.accounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name} ({a.currency})</option>)}</select></div>
      {Object.keys(groups).length === 0 ? <div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 13.5, textAlign: "center", padding: "40px 0" }}>No se encontraron movimientos</div> : Object.entries(groups).map(([date, txs]) => <div key={date} style={{ marginBottom: 14 }}><div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, margin: "6px 4px" }}>{fmtDateLabel(date)}</div><div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "2px 12px", boxShadow: "0 4px 18px rgba(23,37,84,0.05)" }}>{txs.map((t) => <TxRow key={t.id} t={t} category={state.categories.find((c) => c.id === t.categoryId)} account={state.accounts.find((a) => a.id === t.accountId)} onClick={() => onEditTx(t)} />)}</div></div>)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Budgets                                                             */
/* ------------------------------------------------------------------ */
function BudgetsView({ state, onSetBudget }) {
  const currencies = useMemo(() => Array.from(new Set(state.accounts.map((a) => a.currency))), [state.accounts]);
  const [cur, setCur] = useState(currencies[0]);
  useEffect(() => { if (!currencies.includes(cur)) setCur(currencies[0]); }, [currencies.join(",")]);
  const [editingCat, setEditingCat] = useState(null);
  const [value, setValue] = useState("");
  const mKey = monthKey(todayISO());
  const monthExpense = {};
  state.transactions.filter((t) => t.type === "expense" && monthKey(t.date) === mKey && state.accounts.find((a) => a.id === t.accountId)?.currency === cur).forEach((t) => { monthExpense[t.categoryId] = (monthExpense[t.categoryId] || 0) + t.amount; });
  const expenseCats = state.categories.filter((c) => c.type === "expense");
  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 4px", flexWrap: "wrap", gap: 10 }}><h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 800, color: T.text, margin: 0 }}>Presupuestos</h1>{currencies.length > 1 && <div style={{ display: "flex", gap: 6 }}>{currencies.map((c) => <Pill key={c} active={cur === c} onClick={() => setCur(c)}>{c}</Pill>)}</div>}</div>
      <p style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 13.5, margin: "0 0 18px" }}>{monthLabel(mKey)}</p>
      {expenseCats.map((c) => { const key = budgetKey(c.id, cur); const limit = state.budgets[key] || 0; const spent = monthExpense[c.id] || 0; const pct = limit > 0 ? spent / limit : 0; return <div key={c.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14, marginBottom: 10, boxShadow: "0 4px 18px rgba(23,37,84,0.05)" }}><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring pct={limit > 0 ? pct : 0} color={c.color} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 15 }}>{c.icon}</span><span style={{ color: T.text, fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 14 }}>{c.name}</span></div><div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 12, marginTop: 2 }}>{fmtMoney(spent, cur)}{limit > 0 ? ` de ${fmtMoney(limit, cur)}` : ""}</div></div><button onClick={() => { setEditingCat(c.id); setValue(limit ? String(limit) : ""); }} className="tap-target" style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "7px 11px", color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 12.5, fontWeight: 600 }}>{limit > 0 ? "Editar" : "Definir"}</button></div></div>; })}
      <Sheet open={!!editingCat} onClose={() => setEditingCat(null)} title="Presupuesto mensual"><Field label={`Límite mensual (${cur})`}><input style={inputStyle} type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" autoFocus /></Field><button className="tap-target primary-btn" style={{ width: "100%" }} onClick={() => { onSetBudget(editingCat, cur, Number(value) || 0); setEditingCat(null); }}>Guardar</button></Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Accounts                                                            */
/* ------------------------------------------------------------------ */
function AccountsView({ state, onAddAccount, onDeleteAccount, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(ICONS_POOL[0]);
  const [kind, setKind] = useState("debit");
  const [currency, setCurrency] = useState("$");
  const [customCurrency, setCustomCurrency] = useState("");
  const [balance, setBalance] = useState("");
  const balances = computeBalances(state);
  const reset = () => { setName(""); setIcon(ICONS_POOL[0]); setKind("debit"); setCurrency("$"); setCustomCurrency(""); setBalance(""); };
  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 16px", gap: 8 }}><h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 800, color: T.text, margin: 0 }}>Cuentas</h1><div style={{ display: "flex", gap: 7 }}><button onClick={onSignOut} className="tap-target" style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 12, fontWeight: 600 }}>Salir</button><button onClick={() => setOpen(true)} className="tap-target" style={{ background: T.goldSoft, border: `1px solid ${T.gold}55`, borderRadius: 10, padding: "8px 12px", color: T.gold, display: "flex", alignItems: "center", gap: 5, fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700 }}><Plus size={15} /> Cuenta</button></div></div>
      {state.accounts.map((a) => { const bal = balances[a.id] || 0; const isCredit = a.kind === "credit"; return <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14, marginBottom: 10, boxShadow: "0 4px 18px rgba(23,37,84,0.05)" }}><IconBadge icon={a.icon} color={a.color} size={44} /><div style={{ flex: 1 }}><div style={{ color: T.text, fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 15 }}>{a.name}</div><div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 12 }}>{isCredit ? "Tarjeta de crédito" : "Débito / efectivo"} · {a.currency}</div></div><div style={{ textAlign: "right" }}>{isCredit && <div style={{ color: T.textFaint, fontFamily: "Inter, sans-serif", fontSize: 10.5 }}>debés</div>}<div style={{ color: isCredit ? T.expense : T.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 600 }}>{fmtMoney(bal, a.currency)}</div></div>{state.accounts.length > 1 && <button onClick={() => onDeleteAccount(a.id)} className="tap-target" style={{ background: "none", border: "none", color: T.textFaint, marginLeft: 2 }}><Trash2 size={16} /></button>}</div>; })}
      <Sheet open={open} onClose={() => { setOpen(false); reset(); }} title="Nueva cuenta"><Field label="Nombre"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Banco, Visa" /></Field><Field label="Tipo de cuenta"><div style={{ display: "flex", gap: 8 }}><Pill active={kind === "debit"} onClick={() => { setKind("debit"); setIcon(ICONS_POOL[0]); }}>💵 Débito / efectivo</Pill><Pill active={kind === "credit"} onClick={() => { setKind("credit"); setIcon("💳"); }}>💳 Tarjeta de crédito</Pill></div></Field><Field label="Moneda"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{[{ v: "$", l: "Pesos ($)" }, { v: "US$", l: "Dólares (US$)" }, { v: "otra", l: "Otra" }].map((o) => <Pill key={o.v} active={currency === o.v} onClick={() => setCurrency(o.v)}>{o.l}</Pill>)}</div>{currency === "otra" && <input style={{ ...inputStyle, marginTop: 10 }} placeholder="Símbolo, ej: R$, €" value={customCurrency} onChange={(e) => setCustomCurrency(e.target.value)} />}</Field><Field label="Ícono"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{ICONS_POOL.map((ic) => <button key={ic} onClick={() => setIcon(ic)} className="tap-target" style={{ fontSize: 20, width: 42, height: 42, borderRadius: 11, border: `1px solid ${icon === ic ? T.gold : T.border}`, background: icon === ic ? T.goldSoft : T.surface2 }}>{ic}</button>)}</div></Field><Field label={kind === "credit" ? "Deuda actual (si ya tenés)" : "Saldo inicial"}><input style={inputStyle} type="number" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" /></Field><button disabled={!name.trim()} className="tap-target primary-btn" style={{ width: "100%", opacity: name.trim() ? 1 : 0.4 }} onClick={() => { const cur = currency === "otra" ? customCurrency.trim() || "$" : currency; onAddAccount({ id: uid("a"), name: name.trim(), icon, color: T.gold, kind, currency: cur, initialBalance: Number(balance) || 0 }); reset(); setOpen(false); }}>Crear cuenta</button></Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Authentication                                                     */
/* ------------------------------------------------------------------ */
function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const resetPassword = async () => { setMessage(""); const cleanEmail = email.trim(); if (!cleanEmail) { setMessage("Primero ingresá tu email."); return; } setBusy(true); try { const redirectTo = window.location.origin + window.location.pathname; const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo }); if (error) throw error; setMessage("Te enviamos un email para restablecer tu contraseña. Revisá tu bandeja de entrada y Spam."); } catch (err) { console.error("ERROR AL RESTABLECER CONTRASEÑA:", err); setMessage(err?.message || "No se pudo enviar el email de recuperación."); } finally { setBusy(false); } };
  const submit = async (e) => { e.preventDefault(); setMessage(""); const cleanEmail = email.trim(); if (!cleanEmail || !password) { setMessage("Ingresá tu email y contraseña."); return; } setBusy(true); try { if (mode === "login") { const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password }); if (error) throw error; if (!data?.user) throw new Error("No se pudo iniciar sesión."); onAuthenticated(data.user); } else { const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password }); if (error) throw error; if (data?.session && data?.user) onAuthenticated(data.user); else { setMode("login"); setMessage("Cuenta creada. Revisá tu email si Supabase solicita confirmación y después iniciá sesión."); } } } catch (err) { console.error("ERROR DE AUTENTICACIÓN:", err); setMessage(err?.message || "No se pudo completar la operación."); } finally { setBusy(false); } };
  return (
    <Shell><div style={{ minHeight: "100dvh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px)" }}><form onSubmit={submit} style={{ width: "100%", maxWidth: 420 }}><div style={{ fontSize: 42, marginBottom: 10 }}>🪙</div><h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 800, color: T.text, margin: "0 0 8px" }}>Control de Gastos</h1><p style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 14, lineHeight: 1.5, margin: "0 0 26px" }}>{mode === "login" ? "Ingresá para acceder a tus cuentas y movimientos." : "Creá tu cuenta para guardar tus datos de forma segura."}</p><Field label="Email"><input style={inputStyle} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required /></Field><Field label="Contraseña"><input style={inputStyle} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Tu contraseña" minLength={6} required /></Field>{message && <div style={{ color: T.expense, fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.45, marginBottom: 14 }}>{message}</div>}<button type="submit" disabled={busy} className="tap-target primary-btn" style={{ width: "100%", opacity: busy ? 0.6 : 1 }}>{busy ? "Procesando…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</button>{mode === "login" && <button type="button" onClick={resetPassword} disabled={busy} style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 13, padding: "8px 0", textDecoration: "underline", opacity: busy ? 0.6 : 1 }}>¿Olvidaste tu contraseña?</button>}<button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); }} className="tap-target" style={{ width: "100%", marginTop: 12, background: "none", border: "none", color: T.gold, fontFamily: "Inter, sans-serif", fontSize: 13.5, padding: "10px 0" }}>{mode === "login" ? "Crear una cuenta nueva" : "Ya tengo una cuenta"}</button></form></div></Shell>
  );
}

function PasswordRecoveryScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const savePassword = async (e) => { e.preventDefault(); setMessage(""); if (password.length < 6) return setMessage("La contraseña debe tener al menos 6 caracteres."); if (password !== confirm) return setMessage("Las contraseñas no coinciden."); setBusy(true); try { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; setMessage("Contraseña actualizada correctamente."); setTimeout(onDone, 800); } catch (err) { console.error("ERROR AL ACTUALIZAR CONTRASEÑA:", err); setMessage(err?.message || "No se pudo actualizar la contraseña."); } finally { setBusy(false); } };
  return (<Shell><div style={{ minHeight:"100dvh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:"calc(env(safe-area-inset-top) + 24px) 24px" }}><form onSubmit={savePassword} style={{ width:"100%", maxWidth:420 }}><div style={{ fontSize:42, marginBottom:10 }}>🔐</div><h1 style={{ fontFamily:"Sora, sans-serif", fontSize:28, fontWeight:800, color:T.text, margin:"0 0 8px" }}>Nueva contraseña</h1><p style={{ color:T.textMuted, fontFamily:"Inter, sans-serif", fontSize:14, lineHeight:1.5, margin:"0 0 26px" }}>Elegí una contraseña nueva para tu cuenta.</p><Field label="Nueva contraseña"><input style={inputStyle} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={6} required /></Field><Field label="Repetir contraseña"><input style={inputStyle} type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={6} required /></Field>{message && <div style={{ color:message.includes("correctamente")?T.income:T.expense, fontFamily:"Inter, sans-serif", fontSize:13, marginBottom:14 }}>{message}</div>}<button type="submit" disabled={busy} className="tap-target primary-btn" style={{width:"100%", opacity:busy?.6:1}}>{busy?"Guardando…":"Guardar nueva contraseña"}</button></form></div></Shell>);
}

/* ------------------------------------------------------------------ */
/*  App shell                                                          */
/* ------------------------------------------------------------------ */
export default function App() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(defaultState());
  const [user, setUser] = useState(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [tab, setTab] = useState("home");
  const [addOpen, setAddOpen] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  useEffect(() => { let alive = true; if (window.location.hash.includes("type=recovery")) setRecoveryMode(true); supabase.auth.getSession().then(({ data }) => { if (!alive) return; setUser(data?.session?.user || null); if (data?.session?.user) { loadState().then((s) => { if (!alive) return; setState(s); setLoading(false); }); } else setLoading(false); }); const { data: listener } = supabase.auth.onAuthStateChange((event, session) => { if (!alive) return; setUser(session?.user || null); if (event === "PASSWORD_RECOVERY") setRecoveryMode(true); if (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) { setLoading(true); loadState().then((s) => { if (!alive) return; setState(s); setLoading(false); }); } else if (event === "SIGNED_OUT") { setState(defaultState()); setTab("home"); setAddOpen(false); setEditingTx(null); setLoading(false); } }); return () => { alive = false; listener?.subscription?.unsubscribe(); }; }, []);
  useEffect(() => { if (!loading && user) saveState(state); }, [state, loading, user]);
  const handleAuthenticated = async (authenticatedUser) => { setUser(authenticatedUser); setLoading(true); const nextState = await loadState(); setState(nextState); setLoading(false); };
  const handleSignOut = async () => { await supabase.auth.signOut(); };
  const dueRecurring = useMemo(() => { const mKey = monthKey(todayISO()); return state.recurring.filter((r) => r.lastProcessed !== mKey); }, [state.recurring]);
  if (loading) return (<Shell><div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ color: T.textMuted, fontFamily: "Inter, sans-serif", fontSize: 14 }}>Cargando…</div></div></Shell>);
  if (!user) return <AuthScreen onAuthenticated={handleAuthenticated} />;
  if (recoveryMode) return <PasswordRecoveryScreen onDone={() => { window.history.replaceState({}, document.title, window.location.pathname); supabase.auth.getSession().then(({ data }) => setUser(data?.session?.user || null)); }} />;
  if (!state.onboarded) return (<Shell><Onboarding onDone={({ accounts }) => setState((s) => ({ ...s, accounts, onboarded: true }))} /></Shell>);
  const saveTx = (tx) => { setState((s) => { const exists = s.transactions.find((t) => t.id === tx.id); const transactions = exists ? s.transactions.map((t) => (t.id === tx.id ? tx : t)) : [tx, ...s.transactions]; return { ...s, transactions }; }); setAddOpen(false); setEditingTx(null); };
  const deleteTx = (id) => { setState((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) })); setAddOpen(false); setEditingTx(null); };
  const processRecurring = () => { const mKey = monthKey(todayISO()); const newTx = []; const updatedRecurring = state.recurring.map((r) => { if (r.lastProcessed === mKey) return r; newTx.push({ id: uid("t"), type: r.type, amount: r.amount, accountId: r.accountId, categoryId: r.categoryId, date: todayISO(), note: `${r.name} (recurrente)` }); return { ...r, lastProcessed: mKey }; }); setState((s) => ({ ...s, transactions: [...newTx, ...s.transactions], recurring: updatedRecurring })); };
  const tabs = [{ id: "home", label: "Inicio", icon: HomeIcon }, { id: "history", label: "Historial", icon: List }, { id: "budgets", label: "Metas", icon: Target }, { id: "accounts", label: "Cuentas", icon: Wallet }];
  return (
    <Shell>
      <div className="app-shell" style={{ maxWidth: 480, margin: "0 auto", position: "relative", height: "100dvh", overflow: "hidden", paddingTop: "env(safe-area-inset-top)" }}>
        <main className="app-content" style={{ height: "calc(100dvh - env(safe-area-inset-top))", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", paddingTop: 14, paddingBottom: 92 }}>
          {tab === "home" && <HomeView state={state} onEditTx={(t) => setEditingTx(t)} dueRecurring={dueRecurring} onProcessRecurring={processRecurring} />}
          {tab === "history" && <HistoryView state={state} onEditTx={(t) => setEditingTx(t)} />}
          {tab === "budgets" && <BudgetsView state={state} onSetBudget={(catId, cur, val) => setState((s) => ({ ...s, budgets: { ...s.budgets, [budgetKey(catId, cur)]: val } }))} />}
          {tab === "accounts" && <AccountsView state={state} onAddAccount={(a) => setState((s) => ({ ...s, accounts: [...s.accounts, a] }))} onDeleteAccount={(id) => setState((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== id), transactions: s.transactions.filter((t) => t.accountId !== id) }))} onSignOut={handleSignOut} />}
        </main>
        <button onClick={() => setAddOpen(true)} className="tap-target fab" style={{ position: "fixed", right: "max(20px, calc((100vw - 480px) / 2 + 20px))", bottom: "calc(78px + env(safe-area-inset-bottom))", width: 56, height: 56, borderRadius: 18, background: "linear-gradient(135deg, #6542F5 0%, #7B61FF 100%)", border: "none", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 28px rgba(101,66,245,0.28)", zIndex: 40 }}><Plus size={26} strokeWidth={2.5} /></button>
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(14px)", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "center", zIndex: 30, paddingBottom: "env(safe-area-inset-bottom)" }}><div style={{ display: "flex", width: "100%", maxWidth: 480 }}>{tabs.map((tb) => { const Icon = tb.icon; const active = tab === tb.id; return <button key={tb.id} onClick={() => setTab(tb.id)} className="tap-target" style={{ flex: 1, background: "none", border: "none", padding: "10px 0 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: active ? T.gold : T.textFaint }}><Icon size={21} strokeWidth={active ? 2.4 : 2} /><span style={{ fontSize: 10.5, fontFamily: "Inter, sans-serif", fontWeight: active ? 700 : 500 }}>{tb.label}</span></button>; })}</div></div>
        <QuickAddSheet open={addOpen || !!editingTx} editing={editingTx} state={state} onClose={() => { setAddOpen(false); setEditingTx(null); }} onSave={saveTx} onDelete={deleteTx} />
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ background: T.bg, minHeight: "100dvh", height: "100dvh", overflow: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body, #root { background: ${T.bg}; margin: 0; width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; }
        body { color: ${T.text}; }
        input, select { -webkit-appearance: none; appearance: none; }
        input[type="date"] { color-scheme: light; }
        .tap-target { touch-action: manipulation; cursor: pointer; }
        .tap-target:active { opacity: 0.7; }
        .fab:active { transform: scale(0.94); }
        .primary-btn { background: linear-gradient(135deg, #6542F5 0%, #7B61FF 100%); color: #FFFFFF; border: none; border-radius: 13px; padding: 13px 0; font-family: 'Inter', sans-serif; font-weight: 700; font-size: 15px; box-shadow: 0 8px 18px rgba(101,66,245,0.20); }
        .tx-row:not(:last-child) > div { border-bottom: 1px solid ${T.border}; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        input::placeholder { color: ${T.textFaint}; }
        .amount-input::-webkit-outer-spin-button, .amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        ::selection { background: ${T.goldSoft}; }
        .spin { animation: spin 1s linear infinite; }
        .app-content { scrollbar-width: none; }
        .app-content::-webkit-scrollbar { display: none; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      {children}
    </div>
  );
}
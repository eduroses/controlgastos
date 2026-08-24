import { createWorker } from "tesseract.js";

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("spa", 1, {
      logger: () => {},
    });
  }
  return workerPromise;
}

function normalizeAmount(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[^0-9,.-]/g, "").trim();
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (comma >= 0) {
    const decimals = s.length - comma - 1;
    s = decimals === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (dot >= 0) {
    const decimals = s.length - dot - 1;
    s = decimals === 2 ? s : s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pickAmount(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const totalWords = /(total|importe|a pagar|pagar|neto|final|monto)/i;
  const candidates = [];

  for (const line of lines) {
    const matches = line.match(/(?:[$€£]|UYU|USD|U\$S)?\s*[-+]?\d{1,3}(?:[.\s]\d{3})*(?:[,\.]\d{2})|\d+(?:[,\.]\d{2})/g) || [];
    for (const raw of matches) {
      const amount = normalizeAmount(raw);
      if (amount != null && amount > 0 && amount < 100000000) {
        candidates.push({ amount, score: totalWords.test(line) ? 100 : 10, line });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return candidates[0]?.amount ?? null;
}

function pickMerchant(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length >= 3 && !/^(ticket|factura|boleta|recibo|ruc|rut|fecha|hora|total|subtotal|iva|documento)/i.test(line)) {
      return line.slice(0, 60);
    }
  }
  return "";
}

function pickCurrency(text, currencies) {
  const upper = String(text || "").toUpperCase();
  if (/USD|U\$S|DÓLAR|DOLAR/.test(upper) && currencies.includes("US$")) return "US$";
  return currencies.includes("$") ? "$" : currencies[0] || "$";
}

function pickCategory(text, categories) {
  const upper = String(text || "").toUpperCase();
  const rules = [
    [/SUPERMERC|ALMACEN|KIOSCO|PANADER|CARNIC|COMESTIBLE|ALIMENT/, "Comida"],
    [/NAFTA|COMBUSTIBLE|ESTACION|GNC|TAXI|UBER|CABIFY|OMNIBUS|BUS/, "Transporte"],
    [/FARMAC|MEDIC|CLINIC|SALUD|DENTAL/, "Salud"],
    [/LUZ|UTE|OSE|ANTEL|TELEFON|INTERNET|SERVICIO/, "Servicios"],
    [/RESTAUR|CAFE|BAR|PIZZA|DELIVERY/, "Comida"],
    [/CINE|TEATRO|SPOTIFY|NETFLIX|JUEGO|ENTRETEN/, "Ocio"],
    [/ROPA|ZAPAT|SHOPPING|TIENDA|COMPRAS/, "Compras"],
    [/ALQUILER|INMOB|VIVIENDA/, "Vivienda"],
  ];
  for (const [regex, name] of rules) {
    if (regex.test(upper)) {
      const found = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (found) return found.id;
    }
  }
  return categories[0]?.id || "";
}

async function recognizeReceipt(base64) {
  const worker = await getWorker();
  const { data } = await worker.recognize(`data:image/jpeg;base64,${base64}`);
  return data?.text || "";
}

export function installReceiptOcrFetchInterceptor() {
  const originalFetch = window.fetch.bind(window);
  const marker = "__controlGastosReceiptOcrInstalled";
  if (window[marker]) return () => {};
  window[marker] = true;

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.includes("api.anthropic.com/v1/messages")) return originalFetch(input, init);

    try {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const image = body?.messages?.[0]?.content?.find?.((part) => part?.type === "image");
      const promptText = body?.messages?.[0]?.content?.find?.((part) => part?.type === "text")?.text || "";
      const base64 = image?.source?.data;

      if (!base64) return originalFetch(input, init);

      const catMatch = promptText.match(/lista:\s*([^}]+)/i);
      const currencyMatch = promptText.match(/opciones EXACTAS:\s*([^>]+)/i);
      const categories = (catMatch?.[1] || "")
        .split(",")
        .map((x) => x.trim().match(/([^=]+)=([^,]+)/))
        .filter(Boolean)
        .map((m) => ({ id: m[1].trim(), name: m[2].trim() }));
      const currencies = (currencyMatch?.[1] || "$")
        .split(/\s+o\s+/i)
        .map((x) => x.trim().replace(/[<>\"']/g, ""))
        .filter(Boolean);

      const text = await recognizeReceipt(base64);
      const amount = pickAmount(text);
      const result = {
        amount,
        currency: pickCurrency(text, currencies),
        categoryId: pickCategory(text, categories),
        merchant: pickMerchant(text),
        note: pickMerchant(text) || "Compra",
      };

      const payload = {
        id: "local-ocr",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify(result) }],
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("OCR local del ticket falló:", error);
      return new Response(JSON.stringify({
        id: "local-ocr-error",
        content: [{ type: "text", text: JSON.stringify({ amount: null, currency: "$", categoryId: "", merchant: "", note: "" }) }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  return () => {
    window.fetch = originalFetch;
    delete window[marker];
  };
}

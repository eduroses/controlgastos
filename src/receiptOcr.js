import { createWorker } from "tesseract.js";

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) workerPromise = createWorker("spa", 1, { logger: () => {} });
  return workerPromise;
}

function cleanText(text) {
  return String(text || "").replace(/\r/g, "").replace(/[|]/g, "I").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeAmount(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/[Ss]/g, "5").replace(/[^0-9,.\-]/g, "");
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (comma >= 0) {
    s = s.length - comma - 1 === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (dot >= 0) {
    s = s.length - dot - 1 === 2 ? s : s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 100000000 ? n : null;
}

function numberCandidates(line) {
  return String(line || "").replace(/[Oo]/g, "0").replace(/[Il]/g, "1").match(/(?:UYU|USD|U\$S|\$|€|£)?\s*-?\d{1,3}(?:[.\s]\d{3})*(?:[,\.]\d{2})|(?:UYU|USD|U\$S|\$|€|£)?\s*-?\d+(?:[,\.]\d{2})/gi) || [];
}

function amountFromLine(line) {
  const matches = numberCandidates(line);
  for (let i = matches.length - 1; i >= 0; i--) {
    const amount = normalizeAmount(matches[i]);
    if (amount != null) return amount;
  }
  return null;
}

function pickAmount(text) {
  const lines = cleanText(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const strong = /(total\s*(a\s*pagar|general|final)?|importe\s*(total|a\s*pagar)?|a\s*pagar|monto\s*(total|a\s*pagar)?|totalizar)/i;
  const weak = /(subtotal|neto|gravado|iva|impuesto|saldo|vuelto|cambio)/i;
  const candidates = [];

  lines.forEach((line, index) => {
    const amount = amountFromLine(line);
    if (amount == null) return;
    let score = 0;
    if (strong.test(line)) score += 1000;
    if (/\btotal\b/i.test(line)) score += 300;
    if (/(a\s*pagar|importe|monto)/i.test(line)) score += 200;
    if (weak.test(line)) score -= 250;
    if (/\b(rut|ruc|documento|tel|telefono|fecha|hora)\b/i.test(line)) score -= 600;
    score += Math.min(index / Math.max(lines.length, 1), 1) * 40;
    candidates.push({ amount, line, index, score });
  });

  const strongCandidates = candidates.filter((c) => strong.test(c.line) && !weak.test(c.line));
  if (!strongCandidates.length) return { amount: null, confidence: 0, line: "" };
  strongCandidates.sort((a, b) => b.score - a.score || b.index - a.index);
  const best = strongCandidates[0];
  return { amount: best.amount, confidence: Math.min(0.99, 0.75 + Math.min(best.score, 300) / 1200), line: best.line };
}

function looksLikeNoise(line) {
  const s = line.trim();
  if (s.length < 3 || s.length > 80) return true;
  if (/^(ticket|factura|boleta|recibo|comprobante|documento|original|copia)$/i.test(s)) return true;
  if (/^(rut|ruc|nit|tel|telefono|cel|fecha|hora|cajero|terminal|pos)\b/i.test(s)) return true;
  if (/https?:|www\.|@/.test(s)) return true;
  if (/\b\d{2}[\/.-]\d{2}[\/.-]\d{2,4}\b/.test(s)) return true;
  if (/\b\d{8,}\b/.test(s)) return true;
  return false;
}

function pickMerchant(text) {
  const lines = cleanText(text).split(/\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const candidates = [];
  for (let index = 0; index < Math.min(lines.length, 12); index++) {
    const line = lines[index];
    if (looksLikeNoise(line)) continue;
    const letters = (line.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
    const digits = (line.match(/\d/g) || []).length;
    const upper = line.toUpperCase();
    if (letters < 3 || letters <= digits) continue;
    if (/(TOTAL|SUBTOTAL|IVA|RUT|RUC|FECHA|HORA|DIRECCION|DIRECCIÓN|MONTO|IMPORTE)/.test(upper)) continue;
    let score = 100 - index * 7;
    if (letters >= 6) score += 20;
    if (line === upper && letters >= 5) score += 25;
    if (/^[A-ZÁÉÍÓÚÜÑ0-9 .&'-]+$/.test(line)) score += 10;
    if (/\b(S\.?A\.?|S\.?R\.?L\.?|LTDA|SUC|SUPERMERCADO|FARMACIA|RESTAURANTE|CAFETERIA|TIENDA)\b/i.test(line)) score += 30;
    candidates.push({ merchant: line.slice(0, 60), score, index });
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.merchant || "";
}

function pickCurrency(totalLine, text, currencies) {
  const source = `${totalLine}\n${text}`.toUpperCase();
  if (/\b(USD|U\$S|DÓLARES?|DOLLARS?)\b/.test(source) && currencies.includes("US$")) return "US$";
  if (currencies.includes("$")) return "$";
  return currencies[0] || "$";
}

function pickCategory(text, categories) {
  const upper = cleanText(text).toUpperCase();
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
  return categories.find((c) => /otros/i.test(c.name))?.id || categories[0]?.id || "";
}

function dataUrlFromBase64(base64) {
  return String(base64 || "").startsWith("data:") ? String(base64) : `data:image/jpeg;base64,${base64}`;
}

async function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrlFromBase64(base64);
  });
}

function canvasVariant(img, mode) {
  const maxWidth = 2200;
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, maxWidth / Math.max(naturalWidth, 1));
  const width = Math.max(900, Math.round(naturalWidth * scale));
  const height = Math.round(naturalHeight * (width / naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  if (mode === "original") return canvas.toDataURL("image/jpeg", 0.95);

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (mode === "gray") {
      const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
      data[i] = data[i + 1] = data[i + 2] = contrast;
    } else {
      const value = gray > 168 ? 255 : gray < 105 ? 0 : gray > 136 ? 235 : 25;
      data[i] = data[i + 1] = data[i + 2] = value;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.95);
}

async function recognizeVariant(worker, imageData, psm) {
  await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: "1" });
  const { data } = await worker.recognize(imageData);
  return data?.text || "";
}

async function recognizeReceipt(base64) {
  const worker = await getWorker();
  const img = await loadImage(base64);
  const variants = [canvasVariant(img, "original"), canvasVariant(img, "gray"), canvasVariant(img, "threshold")];
  const texts = [];
  for (const variant of variants) {
    texts.push(await recognizeVariant(worker, variant, 6));
    texts.push(await recognizeVariant(worker, variant, 11));
  }
  return texts.filter(Boolean).join("\n");
}

function parsePrompt(promptText) {
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
  return { categories, currencies };
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
      const content = body?.messages?.[0]?.content || [];
      const image = content.find?.((part) => part?.type === "image");
      const promptText = content.find?.((part) => part?.type === "text")?.text || "";
      const base64 = image?.source?.data;
      if (!base64) return originalFetch(input, init);

      const { categories, currencies } = parsePrompt(promptText);
      const text = await recognizeReceipt(base64);
      const amountResult = pickAmount(text);
      const merchant = pickMerchant(text);
      const currency = pickCurrency(amountResult.line, text, currencies);
      const categoryId = pickCategory(text, categories);
      const confidence = amountResult.amount == null ? 0 : Math.max(0, Math.min(0.99, amountResult.confidence));

      const result = {
        amount: amountResult.amount,
        currency,
        categoryId,
        merchant,
        note: merchant || "Compra",
        confidence,
        needsReview: amountResult.amount == null || !merchant || confidence < 0.85,
        rawText: text.slice(0, 12000),
      };

      return new Response(JSON.stringify({
        id: "local-ocr-v2",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify(result) }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (error) {
      console.error("OCR local del ticket falló:", error);
      return new Response(JSON.stringify({
        id: "local-ocr-error",
        content: [{ type: "text", text: JSON.stringify({ amount: null, currency: "$", categoryId: "", merchant: "", note: "", confidence: 0, needsReview: true }) }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  };

  return () => {
    window.fetch = originalFetch;
    delete window[marker];
  };
}

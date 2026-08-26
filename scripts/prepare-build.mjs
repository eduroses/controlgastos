import fs from "node:fs";

const file = "src/control-de-gastos-final.jsx";
let source = fs.readFileSync(file, "utf8");

function replaceOnce(pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next !== source) source = next;
  else if (!label) throw new Error("No se pudo aplicar un cambio");
}

// 1) Cuentas: mantener selector accesible para futuras acciones de edición.
const oldDelete = '<button onClick={() => onDeleteAccount(a.id)} className="tap-target" style={{ background: "none", border: "none", color: T.textFaint, marginLeft: 2 }}><Trash2 size={16} /></button>';
const newDelete = '<button aria-label={`Eliminar ${a.name}`} onClick={() => onDeleteAccount(a.id)} className="tap-target" style={{ background: "none", border: "none", color: T.textFaint, marginLeft: 2 }}><Trash2 size={16} /></button>';
if (source.includes(oldDelete) && !source.includes('aria-label={`Eliminar ${a.name}`}')) {
  source = source.replace(oldDelete, newDelete);
}

// 2) Sheet móvil: scroll real en iOS/PWA.
const oldSheet = 'maxHeight: "88vh",\n          overflowY: "auto",\n          border:';
const newSheet = 'maxHeight: "calc(100dvh - max(34px, env(safe-area-inset-top)) - 24px)",\n          overflowY: "auto",\n          WebkitOverflowScrolling: "touch",\n          touchAction: "pan-y",\n          overscrollBehavior: "contain",\n          border:';
if (source.includes(oldSheet) && !source.includes('touchAction: "pan-y",\n          overscrollBehavior: "contain"')) {
  source = source.replace(oldSheet, newSheet);
}

const oldOverlay = 'display: "flex",\n        alignItems: "flex-end",\n        backdropFilter:';
const newOverlay = 'display: "flex",\n        alignItems: "flex-end",\n        overflowY: "auto",\n        WebkitOverflowScrolling: "touch",\n        touchAction: "pan-y",\n        backdropFilter:';
if (source.includes(oldOverlay) && !source.includes('overflowY: "auto",\n        WebkitOverflowScrolling: "touch",\n        touchAction: "pan-y",\n        backdropFilter:')) {
  source = source.replace(oldOverlay, newOverlay);
}

// 3) Comprobantes: integrar la foto del ticket directamente en el movimiento.
//    La foto se guarda en localStorage asociada al ID del movimiento. Esto evita
//    depender de Storage de Supabase y permite verla aunque el OCR falle.
if (!source.includes("receiptImageData")) {
  replaceOnce(
    /const finalTransactions = remoteTransactions\.length \? remoteTransactions : localTxs;/,
    `const localReceiptById = new Map(localTxs.map((tx) => [tx.id, tx.receiptImageData]).filter(([, image]) => image));
    const finalTransactions = remoteTransactions.length
      ? remoteTransactions.map((tx) => ({ ...tx, receiptImageData: localReceiptById.get(tx.id) || "" }))
      : localTxs;`,
    "carga de comprobantes"
  );

  replaceOnce(
    /const \[scanLabel, setScanLabel\] = useState\(""\);\n\s*const amountRef = useRef\(null\);/,
    `const [scanLabel, setScanLabel] = useState("");
  const [receiptImageData, setReceiptImageData] = useState("");
  const amountRef = useRef(null);`,
    "estado receiptImageData"
  );

  replaceOnce(
    /setNote\(editing\.note \|\| ""\);\n\s*\} else \{\n\s*setType\("expense"\);/,
    `setNote(editing.note || "");
        setReceiptImageData(editing.receiptImageData || "");
      } else {
        setReceiptImageData("");
        setType("expense");`,
    "carga de imagen al editar"
  );

  replaceOnce(
    /const file = e\.target\.files && e\.target\.files\[0\];\n\s*if \(!file\) return;\n\s*setScanStatus\("scanning"\);/,
    `const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const imageData = await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const maxW = 1200;
          const maxH = 1600;
          const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/jpeg", 0.68));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo preparar el comprobante")); };
        img.src = url;
      });
      setReceiptImageData(imageData);
    } catch (imageError) {
      console.warn("No se pudo guardar la foto del comprobante:", imageError);
    }
    setScanStatus("scanning");`,
    "captura de comprobante"
  );

  replaceOnce(
    /note: note\.trim\(\),\n\s*\}\)/,
    `note: note.trim(),
            receiptImageData,
          })`,
    "comprobante al guardar"
  );

  replaceOnce(
    /<Sheet open=\{open\} onClose=\{onClose\} title=\{editing \? "Editar movimiento" : "Nuevo movimiento"\}>/,
    `<Sheet open={open} onClose={onClose} title={editing ? "Editar movimiento" : "Nuevo movimiento"}>
      {editing?.receiptImageData && (
        <div style={{ marginBottom: 18, background: T.surface2, border: \`1px solid \${T.border}\`, borderRadius: 16, padding: 10 }}>
          <div style={{ color: T.text, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Comprobante</div>
          <img src={editing.receiptImageData} alt="Comprobante del gasto" style={{ width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 10, background: "#fff" }} />
          <div style={{ color: T.textMuted, fontSize: 12, marginTop: 8 }}>Foto guardada con este movimiento.</div>
        </div>
      )}`,
    "vista del comprobante"
  );
}

fs.writeFileSync(file, source);
console.log("prepare-build: cuentas, scroll móvil y comprobantes integrados");

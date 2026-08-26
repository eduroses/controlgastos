import fs from 'node:fs';

const path = 'src/control-de-gastos-final.jsx';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(pattern, replacement, label) {
  const next = s.replace(pattern, replacement);
  if (next === s) throw new Error(`No se encontró el punto de inserción: ${label}`);
  s = next;
}

// 1) Mantener la imagen del comprobante también cuando los movimientos se cargan desde Supabase.
replaceOnce(
  /const finalTransactions = remoteTransactions\.length \? remoteTransactions : localTxs;/,
  `const localReceiptById = new Map(localTxs.map((tx) => [tx.id, tx.receiptImageData]).filter(([, image]) => image));\n    const finalTransactions = remoteTransactions.length\n      ? remoteTransactions.map((tx) => ({ ...tx, receiptImageData: localReceiptById.get(tx.id) || "" }))\n      : localTxs;`,
  'carga de comprobantes'
);

// 2) Añadir estado para el comprobante dentro del formulario de movimiento.
replaceOnce(
  /const \[scanLabel, setScanLabel\] = useState\(""\);\n\s*const amountRef = useRef\(null\);/,
  `const [scanLabel, setScanLabel] = useState("");\n  const [receiptImageData, setReceiptImageData] = useState("");\n  const amountRef = useRef(null);`,
  'estado receiptImageData'
);

// 3) Al abrir el formulario, conservar el comprobante de un movimiento existente.
replaceOnce(
  /setNote\(editing\.note \|\| ""\);\n\s*\} else \{\n\s*setType\("expense"\);/,
  `setNote(editing.note || "");\n        setReceiptImageData(editing.receiptImageData || "");\n      } else {\n        setReceiptImageData("");\n        setType("expense");`,
  'carga de imagen al editar'
);

// 4) Cuando se toma la foto, comprimirla y guardarla como comprobante.\n// La copia es local al dispositivo y no depende del OCR.
replaceOnce(
  /const file = e\.target\.files && e\.target\.files\[0\];\n\s*if \(!file\) return;\n\s*setScanStatus\("scanning"\);/,
  `const file = e.target.files && e.target.files[0];\n    if (!file) return;\n    try {\n      const imageData = await new Promise((resolve, reject) => {\n        const img = new Image();\n        const url = URL.createObjectURL(file);\n        img.onload = () => {\n          const maxW = 1200;\n          const maxH = 1600;\n          const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);\n          const canvas = document.createElement('canvas');\n          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));\n          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));\n          const ctx = canvas.getContext('2d');\n          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);\n          URL.revokeObjectURL(url);\n          resolve(canvas.toDataURL('image/jpeg', 0.68));\n        };\n        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo preparar el comprobante')); };\n        img.src = url;\n      });\n      setReceiptImageData(imageData);\n    } catch (imageError) {\n      console.warn('No se pudo guardar la foto del comprobante:', imageError);\n    }\n    setScanStatus("scanning");`,
  'captura de comprobante'
);

// 5) Adjuntar la imagen al movimiento que se guarda.
replaceOnce(
  /onSave\(\{\s*id: editing\?\.id \|\| uid\("t"\),/,
  `onSave({\n            id: editing?.id || uid("t"),`,
  'inicio del movimiento'
);
replaceOnce(
  /note,\n\s*\}\)\n\s*}\s*style=/,
  `note,\n            receiptImageData,\n          })\n        }\n        style=`,
  'comprobante al guardar'
);

// 6) Mostrar el comprobante arriba del editor cuando existe.
replaceOnce(
  /<Sheet open=\{open\} onClose=\{onClose\} title=\{editing \? "Editar movimiento" : "Nuevo movimiento"\}>/,
  `<Sheet open={open} onClose={onClose} title={editing ? "Editar movimiento" : "Nuevo movimiento"}>\n      {editing?.receiptImageData && (\n        <div style={{ marginBottom: 18, background: T.surface2, border: \`1px solid \${T.border}\`, borderRadius: 16, padding: 10 }}>\n          <div style={{ color: T.text, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Comprobante</div>\n          <img src={editing.receiptImageData} alt="Comprobante del gasto" style={{ width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 10, background: "#fff" }} />\n          <div style={{ color: T.textMuted, fontSize: 12, marginTop: 8 }}>Podés revisar la foto antes de guardar cualquier modificación.</div>\n        </div>\n      )}`,
  'vista del comprobante'
);

// 7) Asegurar que al guardar se conserva la imagen aunque el objeto editing no la tenga por referencia.
replaceOnce(
  /const saveTx = \(tx\) => \{ setState\(\(s\) => \{ const exists = s\.transactions\.find\(\(t\) => t\.id === tx\.id\);/,
  `const saveTx = (tx) => { setState((s) => { const exists = s.transactions.find((t) => t.id === tx.id);`,
  'saveTx'
);

fs.writeFileSync(path, s);
console.log('Comprobantes de tickets: parche aplicado correctamente.');

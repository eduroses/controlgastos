import fs from "node:fs";

const file = "src/control-de-gastos-final.jsx";
let source = fs.readFileSync(file, "utf8");

// 1) Las cuentas necesitaban un selector accesible para que AppGate pueda
//    añadir el botón de edición sin depender de la estructura visual del DOM.
const oldDelete = '<button onClick={() => onDeleteAccount(a.id)} className="tap-target" style={{ background: "none", border: "none", color: T.textFaint, marginLeft: 2 }}><Trash2 size={16} /></button>';
const newDelete = '<button aria-label={`Eliminar ${a.name}`} onClick={() => onDeleteAccount(a.id)} className="tap-target" style={{ background: "none", border: "none", color: T.textFaint, marginLeft: 2 }}><Trash2 size={16} /></button>';
if (source.includes(oldDelete) && !source.includes('aria-label={`Eliminar ${a.name}`}')) {
  source = source.replace(oldDelete, newDelete);
}

// 2) La hoja "Nueva cuenta" usa el componente Sheet. Reforzamos el scroll
//    específicamente para iOS/PWA para que todos los campos y el botón queden
//    accesibles aunque la pantalla sea pequeña.
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

fs.writeFileSync(file, source);
console.log("prepare-build: cuentas editables y Sheet móvil reforzado");

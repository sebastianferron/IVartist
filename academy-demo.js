"use strict";

const { spawnSync } = require("node:child_process");

const demoOffers = [
  {
    slug: "automaquillaje",
    category: "course",
    title: "DEMO · Automaquillaje en 4 etapas",
    description: "Practica una rutina completa de automaquillaje. Incluye cuatro capítulos con texto y videos de muestra.",
    price: "120",
    cover: "editorial",
    color: "0x351d32",
    chapters: [
      ["Preparación de la piel", "Aplica una hidratante ligera, deja que se absorba y elige el acabado que quieres conseguir.", "Preparacion de la piel"],
      ["Base y corrección", "Empieza con poca base en el centro del rostro y difumina hacia los bordes. Corrige solo las zonas que lo necesitan.", "Base y correccion"],
      ["Ojos y cejas", "Define las cejas con trazos finos y difumina una sombra de transición desde la cuenca hacia afuera.", "Ojos y cejas"],
      ["Rubor, labios y sellado", "Completa el look con rubor y labial. Sella con polvo ligero en las zonas donde quieras controlar el brillo.", "Rubor, labios y sellado"],
    ],
  },
  {
    slug: "especial-editorial",
    category: "special",
    title: "DEMO · Mirada editorial",
    description: "Especial de una sola lección para practicar un delineado gráfico y combinarlo con un punto de luz.",
    price: "65",
    cover: "red",
    color: "0x41202d",
    chapters: [["Delineado gráfico", "Define la forma con un trazo fino y agrega brillo en un solo punto para mantener el foco en el delineado.", "Delineado grafico"]],
  },
  {
    slug: "vivo-color",
    category: "live",
    title: "DEMO · Vivo de color y contraste",
    description: "Simula la inscripción a un vivo de maquillaje artístico. Al aprobar el aviso de prueba puedes abrir la sala simulada en Mi espacio.",
    price: "85",
    cover: "purple",
    color: "0x271b45",
  },
];

function renderDemoMedia(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", ...args, "pipe:1"], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error?.code === "ENOENT") throw new Error("FFmpeg debe estar disponible en PATH para generar los videos y el QR de prueba.");
  if (result.error || result.status !== 0 || !result.stdout?.length) throw new Error(result.stderr?.toString().trim() || "No se pudo generar el material de demostración.");
  return result.stdout;
}

const font = process.platform === "win32" ? "fontfile='C\\:/Windows/Fonts/arial.ttf'" : "font=Sans";
const caption = (text, size, color, y) => `drawtext=${font}:text='${text}':fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y=${y}`;

function demoQr() {
  const filters = [
    "qrencode=q=300:Q=338:x=51:y=76:text='IVANNA DEMO SIN VALOR DE PAGO'",
    caption("QR DE DEMOSTRACION", 24, "0x351d32", 28),
    caption("Sin valor de pago", 23, "0x351d32", 435),
  ];
  return renderDemoMedia(["-f", "lavfi", "-i", "color=c=white:s=440x490:r=1:d=1", "-vf", filters.join(","), "-frames:v", "1", "-c:v", "png", "-f", "image2pipe"]);
}

function demoReceipt() {
  return renderDemoMedia([
    "-f", "lavfi", "-i", "color=c=white:s=640x360:r=1:d=1", "-vf",
    [caption("COMPROBANTE DE PRUEBA", 30, "0x351d32", 100), caption("Inscripcion simulada. Sin deposito real.", 22, "0x351d32", 174)].join(","),
    "-frames:v", "1", "-c:v", "png", "-f", "image2pipe",
  ]);
}

function demoVideo(title, color) {
  const filters = [
    "drawbox=x=40:y=40:w=560:h=280:color=0xe3b6c8@0.6:t=1",
    caption("IVANNA SALDANA  /  VIDEO DEMO", 17, "0xe3b6c8", 100),
    caption(title, 30, "white", 163),
    caption("Muestra para probar la reproduccion", 16, "0xe3b6c8", 230),
    "fade=t=in:d=0.45",
  ];
  return renderDemoMedia(["-f", "lavfi", "-i", `color=c=${color}:s=640x360:r=24:d=6`, "-vf", filters.join(","), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]);
}

module.exports = { demoOffers, demoQr, demoReceipt, demoVideo };

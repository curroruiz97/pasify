import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export interface EventReportData {
  eventTitle: string;
  eventDate: string | Date;
  venueName: string;
  city?: string | null;
  capacity: number;
  ticketsSold: number;
  attended?: number;
  revenueCents: number;
  averageTicketCents?: number;
  channels?: Array<{ name: string; sold: number; revenueCents: number }>;
  topRRPP?: Array<{ name: string; sold: number; commissionCents: number }>;
  previousEventComparison?: {
    title: string;
    sold: number;
    revenueCents: number;
  };
  nps?: number;
}

const PASIFY_ORANGE: [number, number, number] = [232, 84, 42];
const PASIFY_DEEP: [number, number, number] = [184, 56, 26];
const INK: [number, number, number] = [26, 23, 20];
const INK_2: [number, number, number] = [92, 84, 74];
const INK_3: [number, number, number] = [138, 130, 117];
const CREAM: [number, number, number] = [244, 238, 226];

const formatEur = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/**
 * Genera y descarga el post-mortem en PDF del evento.
 * Diseño editorial Pasify (warm terracota, mono labels, Geist-ish via helvetica).
 */
export const downloadEventReportPdf = (data: EventReportData) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let cursorY = margin;

  // ============ HERO BAND (terracota) ============
  doc.setFillColor(...PASIFY_ORANGE);
  doc.rect(0, 0, pageWidth, 120, "F");
  doc.setFillColor(...PASIFY_DEEP);
  doc.rect(0, 100, pageWidth, 20, "F");

  // Pasify wordmark
  doc.setTextColor(...CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text("Pasify", margin, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("POST-EVENT REPORT", margin, 78);

  // Date right-aligned
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  const reportDate = format(new Date(), "d MMMM yyyy · HH:mm", { locale: es });
  doc.text(`Generado · ${reportDate}h`, pageWidth - margin, 60, { align: "right" });

  cursorY = 150;

  // ============ EVENT TITLE ============
  doc.setTextColor(...INK_3);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("EVENTO", margin, cursorY);
  cursorY += 16;

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(data.eventTitle, margin, cursorY);
  cursorY += 26;

  doc.setTextColor(...INK_2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const subline = [
    format(new Date(data.eventDate), "EEEE d MMM · HH:mm", { locale: es }) + "h",
    data.venueName,
    data.city,
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(subline, margin, cursorY);
  cursorY += 30;

  // ============ KPI TILES (4 boxes) ============
  const tileW = (pageWidth - margin * 2 - 24) / 4;
  const tileH = 90;
  const tiles: Array<{ label: string; value: string; color: [number, number, number] }> = [
    {
      label: "ASISTENCIA",
      value: `${data.attended ?? data.ticketsSold} / ${data.capacity}`,
      color: PASIFY_ORANGE,
    },
    {
      label: "VENDIDOS",
      value: data.ticketsSold.toString(),
      color: [255, 122, 77],
    },
    {
      label: "RECAUDADO",
      value: formatEur(data.revenueCents),
      color: [77, 184, 122],
    },
    {
      label: "TICKET MEDIO",
      value: formatEur(
        data.averageTicketCents ??
          (data.ticketsSold > 0 ? Math.round(data.revenueCents / data.ticketsSold) : 0)
      ),
      color: [232, 176, 76],
    },
  ];

  tiles.forEach((t, i) => {
    const x = margin + i * (tileW + 8);
    doc.setDrawColor(226, 217, 197);
    doc.setFillColor(255, 253, 248);
    doc.roundedRect(x, cursorY, tileW, tileH, 8, 8, "FD");

    doc.setTextColor(...t.color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(t.label, x + 14, cursorY + 22);

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(t.value, x + 14, cursorY + 56);
  });
  cursorY += tileH + 30;

  // ============ CHANNELS TABLE ============
  if (data.channels && data.channels.length > 0) {
    doc.setTextColor(...INK_3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("CANALES DE VENTA", margin, cursorY);
    cursorY += 12;

    autoTable(doc, {
      startY: cursorY,
      head: [["Canal", "Entradas", "Recaudado", "%"]],
      body: data.channels.map((c) => {
        const pct = data.ticketsSold > 0 ? (c.sold / data.ticketsSold) * 100 : 0;
        return [c.name, c.sold.toString(), formatEur(c.revenueCents), `${pct.toFixed(0)}%`];
      }),
      headStyles: { fillColor: INK, textColor: CREAM, fontSize: 9 },
      bodyStyles: { fontSize: 10, textColor: INK },
      alternateRowStyles: { fillColor: [251, 247, 240] },
      margin: { left: margin, right: margin },
      tableLineColor: [226, 217, 197],
      tableLineWidth: 0.5,
    });

    cursorY = (doc as any).lastAutoTable.finalY + 24;
  }

  // ============ TOP RRPP TABLE ============
  if (data.topRRPP && data.topRRPP.length > 0) {
    doc.setTextColor(...INK_3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("TOP RRPP", margin, cursorY);
    cursorY += 12;

    autoTable(doc, {
      startY: cursorY,
      head: [["#", "Nombre", "Entradas vendidas", "Comisión"]],
      body: data.topRRPP.map((r, i) => [
        (i + 1).toString().padStart(2, "0"),
        r.name,
        r.sold.toString(),
        formatEur(r.commissionCents),
      ]),
      headStyles: { fillColor: PASIFY_ORANGE, textColor: CREAM, fontSize: 9 },
      bodyStyles: { fontSize: 10, textColor: INK },
      alternateRowStyles: { fillColor: [251, 247, 240] },
      margin: { left: margin, right: margin },
      tableLineColor: [226, 217, 197],
      tableLineWidth: 0.5,
    });

    cursorY = (doc as any).lastAutoTable.finalY + 24;
  }

  // ============ COMPARISON ============
  if (data.previousEventComparison) {
    const c = data.previousEventComparison;
    const deltaSold = data.ticketsSold - c.sold;
    const deltaRev = data.revenueCents - c.revenueCents;
    const deltaSoldPct = c.sold > 0 ? (deltaSold / c.sold) * 100 : 0;

    doc.setTextColor(...INK_3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("VS EVENTO ANTERIOR", margin, cursorY);
    cursorY += 18;

    doc.setFillColor(251, 228, 211);
    doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 60, 8, 8, "F");

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(c.title, margin + 16, cursorY + 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK_2);
    doc.text(
      `Entradas: ${deltaSold >= 0 ? "+" : ""}${deltaSold} (${deltaSoldPct.toFixed(1)}%)  ·  Recaudado: ${deltaRev >= 0 ? "+" : ""}${formatEur(deltaRev)}`,
      margin + 16,
      cursorY + 42
    );

    cursorY += 78;
  }

  // ============ NPS ============
  if (typeof data.nps === "number") {
    doc.setTextColor(...INK_3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("NPS RECOGIDO A LA SALIDA", margin, cursorY);
    cursorY += 18;

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(48);
    doc.text(data.nps.toString(), margin, cursorY + 30);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK_2);
    const npsLabel =
      data.nps >= 50 ? "Excelente" : data.nps >= 30 ? "Bueno" : data.nps >= 0 ? "Mejorable" : "Crítico";
    doc.text(`Net Promoter Score · ${npsLabel}`, margin + 90, cursorY + 22);
  }

  // ============ FOOTER ============
  const footerY = doc.internal.pageSize.getHeight() - 30;
  doc.setDrawColor(226, 217, 197);
  doc.line(margin, footerY, pageWidth - margin, footerY);
  doc.setTextColor(...INK_3);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Generado con Pasify · El sistema operativo de los eventos", margin, footerY + 14);
  doc.text("pasify.es", pageWidth - margin, footerY + 14, { align: "right" });

  const safeName = data.eventTitle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .slice(0, 40);
  doc.save(`pasify-${safeName || "evento"}-${format(new Date(data.eventDate), "yyyy-MM-dd")}.pdf`);
};

/**
 * Mock de datos demo para previsualizar el report sin Supabase.
 */
export const buildDemoEventReport = (
  overrides: Partial<EventReportData> & Pick<EventReportData, "eventTitle" | "eventDate" | "venueName">
): EventReportData => {
  const sold = overrides.ticketsSold ?? 612;
  const capacity = overrides.capacity ?? 800;
  const revenue = overrides.revenueCents ?? sold * 1500;
  return {
    capacity,
    ticketsSold: sold,
    attended: Math.round(sold * 0.92),
    revenueCents: revenue,
    averageTicketCents: Math.round(revenue / Math.max(1, sold)),
    channels: [
      { name: "Web pública", sold: Math.round(sold * 0.62), revenueCents: Math.round(revenue * 0.62) },
      { name: "RRPP", sold: Math.round(sold * 0.22), revenueCents: Math.round(revenue * 0.22) },
      { name: "Box office (taquilla)", sold: Math.round(sold * 0.12), revenueCents: Math.round(revenue * 0.12) },
      { name: "Cortesías", sold: Math.round(sold * 0.04), revenueCents: 0 },
    ],
    topRRPP: [
      { name: "Carla Sánchez", sold: 38, commissionCents: 11400 },
      { name: "Diego Reyes", sold: 27, commissionCents: 8100 },
      { name: "Lucía García", sold: 19, commissionCents: 5700 },
    ],
    previousEventComparison: {
      title: "Saturday Night · Hace 7 días",
      sold: Math.round(sold * 0.86),
      revenueCents: Math.round(revenue * 0.86),
    },
    nps: 64,
    ...overrides,
  };
};

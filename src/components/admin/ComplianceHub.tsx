import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Flag,
  Globe,
  IdCard,
  Lock,
  Music,
  Receipt,
  Scale,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// GDPR DSAR (Data Subject Access Requests)
// =============================================================

interface DsarRequest {
  id: string;
  email: string;
  type: "export" | "deletion" | "rectification";
  status: "pending" | "in_progress" | "completed" | "rejected";
  receivedAt: Date;
  dueDate: Date;
}

const DSAR: DsarRequest[] = [
  { id: "dsar-01", email: "carla.s@gmail.com", type: "export", status: "in_progress", receivedAt: subDays(new Date(), 3), dueDate: subDays(new Date(), -27) },
  { id: "dsar-02", email: "diego.r@hotmail.com", type: "deletion", status: "pending", receivedAt: subDays(new Date(), 1), dueDate: subDays(new Date(), -29) },
  { id: "dsar-03", email: "lucia.g@yahoo.es", type: "rectification", status: "completed", receivedAt: subDays(new Date(), 8), dueDate: subDays(new Date(), 22) },
  { id: "dsar-04", email: "pablo.l@protonmail.com", type: "export", status: "completed", receivedAt: subDays(new Date(), 14), dueDate: subDays(new Date(), 16) },
  { id: "dsar-05", email: "anonimo+temp@guerrillamail.com", type: "deletion", status: "rejected", receivedAt: subDays(new Date(), 22), dueDate: subDays(new Date(), 8) },
];

const DSAR_TYPE: Record<DsarRequest["type"], { label: string; color: string; icon: React.ReactNode }> = {
  export: { label: "Export", color: "#FF7A4D", icon: <Download className="h-3 w-3" /> },
  deletion: { label: "Borrado", color: "#B8381A", icon: <Trash2 className="h-3 w-3" /> },
  rectification: { label: "Rectificación", color: "#E8B04C", icon: <UserCheck className="h-3 w-3" /> },
};

const DSAR_STATUS: Record<DsarRequest["status"], { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "#E8B04C" },
  in_progress: { label: "En curso", color: "#4DB87A" },
  completed: { label: "Completado", color: "#5C544A" },
  rejected: { label: "Rechazado", color: "#8A8275" },
};

// =============================================================
// Tax reports
// =============================================================

const TAX_REPORTS = [
  { country: "ES", label: "España · IVA", code: "Modelo 303", lastFiled: subDays(new Date(), 14), revenueCents: 1_842_500_00, vatCents: 386_925_00, status: "ok" },
  { country: "ES", label: "España · Operaciones intracom.", code: "Modelo 349", lastFiled: subDays(new Date(), 14), revenueCents: 124_200_00, vatCents: 26_082_00, status: "ok" },
  { country: "ES", label: "España · Resumen anual", code: "Modelo 347", lastFiled: subDays(new Date(), 64), revenueCents: 22_180_400_00, vatCents: 0, status: "ok" },
  { country: "FR", label: "France · TVA", code: "CA12", lastFiled: subDays(new Date(), 18), revenueCents: 248_400_00, vatCents: 49_680_00, status: "ok" },
  { country: "IT", label: "Italia · IVA", code: "LIPE Q1", lastFiled: subDays(new Date(), 22), revenueCents: 188_800_00, vatCents: 41_536_00, status: "needs_review" },
  { country: "PT", label: "Portugal · IVA", code: "Modelo IVA", lastFiled: subDays(new Date(), 9), revenueCents: 92_400_00, vatCents: 19_404_00, status: "ok" },
];

// =============================================================
// Music licenses
// =============================================================

const LICENSES = [
  { name: "SGAE", country: "ES", status: "active", coverage: "Música en vivo + ambiente", monthlyCents: 1_240_00, eventsCovered: 184 },
  { name: "DACEM", country: "ES", status: "active", coverage: "Comunicación pública", monthlyCents: 480_00, eventsCovered: 184 },
  { name: "SACEM", country: "FR", status: "active", coverage: "Droits d'auteur", monthlyCents: 720_00, eventsCovered: 28 },
  { name: "SIAE", country: "IT", status: "pending", coverage: "Diritto d'autore", monthlyCents: 0, eventsCovered: 0 },
];

// =============================================================
// Age verification
// =============================================================

const AGE_CHECKS = {
  enabled18: true,
  enabled21: false,
  todayChecked: 184,
  todayRejected: 12,
  monthChecked: 4842,
  failureRatePct: 6.5,
};

// =============================================================
// Aforo legal alerts
// =============================================================

const AFORO_ALERTS = [
  { venue: "Pacha Ibiza · Main Room", current: 2940, legal: 3000, pct: 98, severity: "critical" },
  { venue: "Razzmatazz · Sala 1", current: 1620, legal: 1800, pct: 90, severity: "warning" },
  { venue: "Costa Brava · Lloret", current: 1080, legal: 1200, pct: 90, severity: "warning" },
];

// =============================================================
// Main
// =============================================================

export const ComplianceHub = () => {
  const [tab, setTab] = useState<"gdpr" | "tax" | "licenses" | "age" | "aforo">("gdpr");

  const pendingDsar = DSAR.filter((d) => d.status === "pending" || d.status === "in_progress").length;
  const overdueDsar = DSAR.filter(
    (d) => (d.status === "pending" || d.status === "in_progress") && d.dueDate.getTime() < Date.now()
  ).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-1 text-3xl font-bold tracking-tight">
          Compliance <span style={serif} className="text-orange-500">&</span> Legal
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          GDPR · IVA multi-país · Licencias de música · Edad legal · Aforo bomberos.
        </p>
      </header>

      {/* Status banner */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          background:
            overdueDsar > 0
              ? "linear-gradient(135deg, rgba(184,56,26,0.18) 0%, rgba(184,56,26,0.04) 100%)"
              : "linear-gradient(135deg, rgba(77,184,122,0.18) 0%, rgba(77,184,122,0.04) 100%)",
          borderColor: overdueDsar > 0 ? "rgba(184,56,26,0.5)" : "rgba(77,184,122,0.4)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white"
            style={{
              background: overdueDsar > 0
                ? "linear-gradient(180deg, #B8381A 0%, #6F1F08 100%)"
                : "linear-gradient(180deg, #4DB87A 0%, #2D7A4F 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
          >
            {overdueDsar > 0 ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.22em",
                color: overdueDsar > 0 ? "#B8381A" : "#4DB87A",
              }}
            >
              {overdueDsar > 0 ? "Atención" : "Todo en orden"}
            </div>
            <h3 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
              {overdueDsar > 0
                ? `${overdueDsar} solicitud(es) GDPR fuera de plazo`
                : "La red cumple con GDPR · IVA · licencias musicales"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {pendingDsar} DSAR pendientes · 4 países activos · {LICENSES.filter((l) => l.status === "active").length} licencias activas
            </p>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-end gap-1 overflow-x-auto border-b border-border">
        <Tab active={tab === "gdpr"} onClick={() => setTab("gdpr")} icon={<Lock className="h-4 w-4" />}>
          GDPR · DSAR
        </Tab>
        <Tab active={tab === "tax"} onClick={() => setTab("tax")} icon={<Receipt className="h-4 w-4" />}>
          Fiscalidad
        </Tab>
        <Tab active={tab === "licenses"} onClick={() => setTab("licenses")} icon={<Music className="h-4 w-4" />}>
          Licencias
        </Tab>
        <Tab active={tab === "age"} onClick={() => setTab("age")} icon={<IdCard className="h-4 w-4" />}>
          Edad
        </Tab>
        <Tab active={tab === "aforo"} onClick={() => setTab("aforo")} icon={<UserCheck className="h-4 w-4" />}>
          Aforo legal
        </Tab>
      </div>

      {tab === "gdpr" && <DsarPanel />}
      {tab === "tax" && <TaxPanel />}
      {tab === "licenses" && <LicensesPanel />}
      {tab === "age" && <AgePanel />}
      {tab === "aforo" && <AforoPanel />}
    </div>
  );
};

const Tab = ({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group relative inline-flex shrink-0 items-center gap-2 px-3 pb-3 pt-1 text-sm font-medium transition md:px-4"
    style={{ color: active ? "#F4EEE2" : "#8A8275" }}
  >
    {icon}
    {children}
    <span
      aria-hidden="true"
      className="absolute inset-x-3 -bottom-px h-0.5 transition"
      style={{
        background: active
          ? "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)"
          : "transparent",
        boxShadow: active ? "0 0 12px rgba(232,84,42,0.65)" : "none",
      }}
    />
  </button>
);

// =============================================================
// GDPR / DSAR panel
// =============================================================

const DsarPanel = () => (
  <section className="space-y-3">
    <div
      className="rounded-2xl border border-border bg-card p-5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Shield className="h-3 w-3" />
            Solicitudes RGPD · 30 días
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            {DSAR.length} solicitudes en plazo legal
          </h3>
        </div>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export auditoría
        </Button>
      </div>
    </div>

    <div className="space-y-2">
      {DSAR.map((d) => (
        <DsarRow key={d.id} req={d} />
      ))}
    </div>
  </section>
);

const DsarRow = ({ req }: { req: DsarRequest }) => {
  const type = DSAR_TYPE[req.type];
  const status = DSAR_STATUS[req.status];
  const daysToDue = Math.ceil((req.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  const overdue = daysToDue < 0 && (req.status === "pending" || req.status === "in_progress");

  return (
    <article
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row md:items-center md:gap-4 md:p-5"
      style={{
        borderColor: overdue ? "rgba(184,56,26,0.5)" : "rgba(244,238,226,0.08)",
        background: overdue ? "rgba(184,56,26,0.04)" : undefined,
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
      }}
    >
      <div className="flex flex-1 items-center gap-3">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
          style={{
            background: `linear-gradient(180deg, ${type.color}DD 0%, ${type.color} 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 10px -3px ${type.color}88`,
          }}
        >
          {type.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: `${type.color}22`,
                color: type.color,
              }}
            >
              {type.label}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: `${status.color}22`,
                color: status.color,
              }}
            >
              {status.label}
            </span>
            {overdue && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                style={{
                  ...mono,
                  letterSpacing: "0.16em",
                  background: "rgba(184,56,26,0.2)",
                  color: "#B8381A",
                }}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Fuera de plazo
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground" style={mono}>
            {req.email}
          </div>
          <div
            className="mt-0.5 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.14em" }}
          >
            {req.id.toUpperCase()} · Recibido {format(req.receivedAt, "d MMM", { locale: es })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="text-right">
          <div
            className="text-[9px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            Plazo
          </div>
          <div
            className="text-sm font-bold"
            style={{
              ...mono,
              color: overdue ? "#B8381A" : daysToDue < 7 ? "#E8B04C" : "#4DB87A",
            }}
          >
            {overdue ? `${Math.abs(daysToDue)}d tarde` : `${daysToDue}d`}
          </div>
        </div>
        {req.status === "pending" || req.status === "in_progress" ? (
          <Button size="sm">Procesar</Button>
        ) : (
          <Button size="sm" variant="ghost">Ver</Button>
        )}
      </div>
    </article>
  );
};

// =============================================================
// Tax panel
// =============================================================

const TaxPanel = () => (
  <section className="space-y-3">
    <div
      className="rounded-2xl border border-border bg-card p-5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Receipt className="h-3 w-3" />
            Fiscalidad multi-país
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            {TAX_REPORTS.length} declaraciones activas
          </h3>
        </div>
        <Button>
          <Download className="mr-2 h-4 w-4" />
          Generar trimestre
        </Button>
      </div>
    </div>

    <div className="space-y-2">
      {TAX_REPORTS.map((r) => (
        <article
          key={`${r.country}-${r.code}`}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 md:flex-row md:items-center md:gap-4 md:p-5"
          style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
        >
          <div className="flex flex-1 items-center gap-3">
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
              style={{
                background: "linear-gradient(180deg, #4DB87A 0%, #2D7A4F 100%)",
              }}
            >
              <Banknote className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] uppercase"
                  style={{
                    ...mono,
                    letterSpacing: "0.18em",
                    background: "rgba(255,255,255,0.04)",
                    color: "#C9BFA8",
                  }}
                >
                  <Flag className="mr-1 inline-block h-2.5 w-2.5" />
                  {r.country}
                </span>
                <span className="text-sm font-semibold text-foreground">{r.label}</span>
              </div>
              <div
                className="mt-1 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.14em" }}
              >
                {r.code} · Última {format(r.lastFiled, "d MMM yyyy", { locale: es })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <div
                className="text-[9px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.14em" }}
              >
                Base
              </div>
              <div className="text-sm font-bold text-foreground" style={mono}>
                {(r.revenueCents / 100 / 1000).toFixed(0)}k€
              </div>
            </div>
            <div>
              <div
                className="text-[9px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.14em" }}
              >
                IVA
              </div>
              <div className="text-sm font-bold text-foreground" style={mono}>
                {(r.vatCents / 100 / 1000).toFixed(1)}k€
              </div>
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: r.status === "ok" ? "rgba(77,184,122,0.18)" : "rgba(232,176,76,0.18)",
                color: r.status === "ok" ? "#4DB87A" : "#E8B04C",
              }}
            >
              {r.status === "ok" ? "OK" : "Revisar"}
            </span>
          </div>
        </article>
      ))}
    </div>
  </section>
);

// =============================================================
// Licenses
// =============================================================

const LicensesPanel = () => (
  <section className="space-y-3">
    <div
      className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
      style={{ ...mono, letterSpacing: "0.2em" }}
    >
      <Music className="h-3 w-3" />
      Licencias musicales y derechos
    </div>

    {LICENSES.map((l) => (
      <article
        key={l.name}
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 md:p-5"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white"
          style={{
            background:
              l.status === "active"
                ? "linear-gradient(180deg, #E8B04C 0%, #A6781D 100%)"
                : "rgba(255,255,255,0.06)",
            color: l.status === "active" ? "#fff" : "#8A8275",
          }}
        >
          <Music className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-foreground">{l.name}</h4>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: "rgba(255,255,255,0.04)",
                color: "#C9BFA8",
              }}
            >
              <Flag className="mr-1 inline-block h-2.5 w-2.5" />
              {l.country}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: l.status === "active" ? "rgba(77,184,122,0.18)" : "rgba(232,176,76,0.18)",
                color: l.status === "active" ? "#4DB87A" : "#E8B04C",
              }}
            >
              {l.status === "active" ? "Activa" : "Pendiente"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{l.coverage}</p>
          <div
            className="mt-1 text-[11px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.14em" }}
          >
            {l.eventsCovered} eventos cubiertos · {(l.monthlyCents / 100).toFixed(0)}€/mes
          </div>
        </div>
        <Button size="sm" variant="outline">
          Detalles
        </Button>
      </article>
    ))}
  </section>
);

// =============================================================
// Age verification panel
// =============================================================

const AgePanel = () => (
  <section className="space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <Kpi color="#FF7A4D" eyebrow="Checks hoy" value={AGE_CHECKS.todayChecked.toString()} icon={<UserCheck className="h-4 w-4" />} />
      <Kpi color="#B8381A" eyebrow="Rechazados hoy" value={AGE_CHECKS.todayRejected.toString()} icon={<UserX className="h-4 w-4" />} />
      <Kpi color="#E8542A" eyebrow="Checks 30d" value={AGE_CHECKS.monthChecked.toLocaleString("es-ES")} icon={<IdCard className="h-4 w-4" />} />
      <Kpi color="#E8B04C" eyebrow="Tasa fallo" value={`${AGE_CHECKS.failureRatePct}%`} icon={<AlertTriangle className="h-4 w-4" />} />
    </div>

    <section
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      <div className="mb-4">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <Lock className="h-3 w-3" />
          Configuración de edad mínima
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Política <span style={serif} className="text-orange-500">por evento</span>
        </h3>
      </div>

      <div className="space-y-3">
        <PolicyRow
          label="18+ exigido"
          description="Discotecas y eventos con consumo de alcohol"
          enabled={AGE_CHECKS.enabled18}
        />
        <PolicyRow
          label="21+ exigido"
          description="Aplicado a eventos premium específicos"
          enabled={AGE_CHECKS.enabled21}
        />
        <PolicyRow
          label="Verificación con DNI escaneado"
          description="OCR del DNI/NIE en checkout · una sola vez por cuenta"
          enabled
        />
        <PolicyRow
          label="Doble verificación en puerta"
          description="Compara foto del DNI con cara escaneada al entrar (AI-8)"
          enabled
        />
      </div>
    </section>
  </section>
);

const PolicyRow = ({
  label,
  description,
  enabled,
}: {
  label: string;
  description: string;
  enabled: boolean;
}) => (
  <div
    className="flex items-center gap-3 rounded-xl border border-border p-3"
    style={{ background: "rgba(255,255,255,0.02)" }}
  >
    <div
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
      style={{
        background: enabled ? "rgba(77,184,122,0.18)" : "rgba(255,255,255,0.04)",
        color: enabled ? "#4DB87A" : "#8A8275",
      }}
    >
      {enabled ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p
        className="mt-0.5 text-[11px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.14em" }}
      >
        {description}
      </p>
    </div>
    <span
      className="rounded-full px-2 py-0.5 text-[9px] uppercase"
      style={{
        ...mono,
        letterSpacing: "0.18em",
        background: enabled ? "rgba(77,184,122,0.18)" : "rgba(140,140,140,0.12)",
        color: enabled ? "#4DB87A" : "#8A8275",
      }}
    >
      {enabled ? "Activo" : "Inactivo"}
    </span>
  </div>
);

// =============================================================
// Aforo legal alerts
// =============================================================

const AforoPanel = () => (
  <section className="space-y-3">
    <div
      className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
      style={{ ...mono, letterSpacing: "0.2em" }}
    >
      <Scale className="h-3 w-3" />
      Aforo legal · bomberos
    </div>

    {AFORO_ALERTS.map((a) => {
      const color = a.severity === "critical" ? "#B8381A" : "#E8B04C";
      const label = a.severity === "critical" ? "Crítico" : "Aviso";
      return (
        <article
          key={a.venue}
          className="rounded-2xl border bg-card p-4 md:p-5"
          style={{
            borderColor: `${color}50`,
            background: `${color}08`,
            boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                  style={{
                    ...mono,
                    letterSpacing: "0.18em",
                    background: `${color}22`,
                    color,
                  }}
                >
                  {label}
                </span>
              </div>
              <div className="mt-1 text-base font-semibold text-foreground">{a.venue}</div>
              <div
                className="mt-1 text-[11px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.16em" }}
              >
                {a.current.toLocaleString("es-ES")} / {a.legal.toLocaleString("es-ES")} aforo · {a.pct}%
              </div>
            </div>
            {a.severity === "critical" && (
              <Button size="sm">Cerrar venta</Button>
            )}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${a.pct}%`,
                background: `linear-gradient(90deg, ${color}AA 0%, ${color} 100%)`,
                boxShadow: `0 0 12px ${color}88`,
              }}
            />
          </div>
        </article>
      );
    })}
  </section>
);

const Kpi = ({
  color,
  eyebrow,
  value,
  icon,
}: {
  color: string;
  eyebrow: string;
  value: string;
  icon: React.ReactNode;
}) => (
  <div
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 md:p-5"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 12px -6px rgba(0,0,0,0.4)" }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full"
      style={{ background: `${color}26`, filter: "blur(28px)" }}
    />
    <div
      className="relative inline-flex items-center gap-1.5 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.18em", color }}
    >
      {icon}
      {eyebrow}
    </div>
    <div
      className="relative mt-3 text-2xl font-bold tracking-tight text-foreground md:text-3xl"
      style={mono}
    >
      {value}
    </div>
  </div>
);

export default ComplianceHub;

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Eye,
  Fingerprint,
  Gavel,
  Globe,
  Mail,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

type CaseKind = "qr_dup" | "passback" | "chargeback" | "rrpp_abuse" | "card_velocity" | "ip_blacklist";
type CaseSeverity = "low" | "medium" | "high" | "critical";
type CaseStatus = "open" | "investigating" | "resolved" | "false_positive";

interface FraudCase {
  id: string;
  kind: CaseKind;
  severity: CaseSeverity;
  status: CaseStatus;
  title: string;
  description: string;
  detectedAt: Date;
  evidence: { label: string; value: string }[];
  riskScore: number;
  amountCents?: number;
  partnerName?: string;
}

const now = Date.now();
const CASES: FraudCase[] = [
  {
    id: "f-01",
    kind: "qr_dup",
    severity: "high",
    status: "open",
    title: "QR escaneado desde 2 puertas distintas",
    description: "Mismo QR validado en Puerta 1 a las 23:42 y en Puerta 2 a las 23:43 (30s).",
    detectedAt: new Date(now - 12 * 60 * 1000),
    evidence: [
      { label: "Ticket", value: "TKT-0184729" },
      { label: "Evento", value: "Saturday Night · Pacha" },
      { label: "Puerta 1", value: "23:42:18 (Diego R.)" },
      { label: "Puerta 2", value: "23:43:05 (Carla S.)" },
      { label: "Δ tiempo", value: "47 segundos" },
    ],
    riskScore: 87,
    partnerName: "Pacha Ibiza",
  },
  {
    id: "f-02",
    kind: "card_velocity",
    severity: "critical",
    status: "open",
    title: "Tarjeta usada en 4 cuentas en 1 hora",
    description: "Una misma tarjeta (BIN 459478) ha pagado entradas desde 4 emails distintos.",
    detectedAt: new Date(now - 38 * 60 * 1000),
    evidence: [
      { label: "BIN", value: "459478 ••• 8821" },
      { label: "Cuentas", value: "4 únicas" },
      { label: "Importe total", value: "240€" },
      { label: "IP origen", value: "37.142.81.* (Madrid)" },
    ],
    riskScore: 96,
    amountCents: 24000,
  },
  {
    id: "f-03",
    kind: "chargeback",
    severity: "medium",
    status: "investigating",
    title: "Chargeback Visa · 'product not received'",
    description: "Cliente reclama no haber recibido el ticket — log muestra QR escaneado en puerta.",
    detectedAt: new Date(now - 6 * 60 * 60 * 1000),
    evidence: [
      { label: "Charge ID", value: "ch_3OvP2k...8q" },
      { label: "Cliente", value: "j.lopez@gmail.com" },
      { label: "Scan log", value: "✓ Sí (23:54)" },
      { label: "Disputa abierta", value: "Hace 4h" },
    ],
    riskScore: 64,
    amountCents: 4500,
    partnerName: "Razzmatazz",
  },
  {
    id: "f-04",
    kind: "rrpp_abuse",
    severity: "medium",
    status: "open",
    title: "RRPP con tasa de cancelación 38%",
    description: "Carla M. tiene 12 cancelaciones en 7 días — vs media red 2.4%.",
    detectedAt: new Date(now - 18 * 60 * 60 * 1000),
    evidence: [
      { label: "RRPP", value: "Carla M. · CARLA09" },
      { label: "Vendido 7d", value: "31 tickets" },
      { label: "Cancelado", value: "12 (38.7%)" },
      { label: "Reembolsado", value: "180€" },
    ],
    riskScore: 71,
    partnerName: "Sala Apolo",
  },
  {
    id: "f-05",
    kind: "ip_blacklist",
    severity: "high",
    status: "open",
    title: "IP en blacklist Tor compró 3 entradas",
    description: "Compra desde nodo de salida Tor identificado como abusivo en últimas 24h.",
    detectedAt: new Date(now - 2 * 60 * 60 * 1000),
    evidence: [
      { label: "IP", value: "185.220.101.42" },
      { label: "ASN", value: "AS200052 (Tor exit)" },
      { label: "User-agent", value: "Headless Chrome" },
      { label: "Fingerprint", value: "Compartido con 2 cuentas más" },
    ],
    riskScore: 82,
    amountCents: 4500,
  },
  {
    id: "f-06",
    kind: "passback",
    severity: "low",
    status: "false_positive",
    title: "Sospecha de passback descartada",
    description: "Trabajaba la pulsera con un familiar, validado por host del local.",
    detectedAt: new Date(now - 26 * 60 * 60 * 1000),
    evidence: [
      { label: "Pulsera", value: "WB-2941" },
      { label: "Host", value: "Lucía G. validó" },
    ],
    riskScore: 22,
  },
];

const KIND_CONFIG: Record<CaseKind, { label: string; icon: React.ReactNode; color: string }> = {
  qr_dup: { label: "QR duplicado", icon: <Fingerprint className="h-3.5 w-3.5" />, color: "#E8542A" },
  passback: { label: "Passback", icon: <Eye className="h-3.5 w-3.5" />, color: "#E8B04C" },
  chargeback: { label: "Chargeback", icon: <Gavel className="h-3.5 w-3.5" />, color: "#B8381A" },
  rrpp_abuse: { label: "Abuso RRPP", icon: <ShieldAlert className="h-3.5 w-3.5" />, color: "#FF7A4D" },
  card_velocity: { label: "Velocity tarjeta", icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "#B8381A" },
  ip_blacklist: { label: "IP blacklist", icon: <Globe className="h-3.5 w-3.5" />, color: "#E8542A" },
};

const SEV_CONFIG: Record<CaseSeverity, { label: string; color: string }> = {
  low: { label: "Bajo", color: "#8A8275" },
  medium: { label: "Medio", color: "#E8B04C" },
  high: { label: "Alto", color: "#E8542A" },
  critical: { label: "Crítico", color: "#B8381A" },
};

const STATUS_CONFIG: Record<CaseStatus, { label: string; color: string }> = {
  open: { label: "Abierto", color: "#E8542A" },
  investigating: { label: "Investigando", color: "#E8B04C" },
  resolved: { label: "Resuelto", color: "#4DB87A" },
  false_positive: { label: "Falso pos.", color: "#8A8275" },
};

// =============================================================
// Main
// =============================================================

export const TrustSafetyCenter = () => {
  const [tab, setTab] = useState<"queue" | "blacklists" | "rules">("queue");
  const [selectedId, setSelectedId] = useState<string | null>(CASES[0]?.id ?? null);

  const stats = useMemo(() => {
    const open = CASES.filter((c) => c.status === "open" || c.status === "investigating");
    const totalRisk = CASES.reduce((s, c) => s + (c.amountCents ?? 0), 0);
    return {
      openCount: open.length,
      avgRisk: open.length > 0 ? Math.round(open.reduce((s, c) => s + c.riskScore, 0) / open.length) : 0,
      moneyAtRisk: totalRisk,
      preventedThisMonth: 14_320_00,
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-1 text-3xl font-bold tracking-tight">
          Trust <span style={serif} className="text-orange-500">&</span> Safety
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Centro anti-fraude: cola de casos, reglas, listas y disputas — en tiempo real.
        </p>
      </header>

      {/* Hero KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile
          icon={<ShieldAlert className="h-4 w-4" />}
          color="#E8542A"
          eyebrow="Casos abiertos"
          value={stats.openCount.toString()}
          sub={`${CASES.filter((c) => c.severity === "critical").length} críticos`}
          pulse={stats.openCount > 0}
        />
        <KpiTile
          icon={<AlertTriangle className="h-4 w-4" />}
          color="#B8381A"
          eyebrow="Risk medio"
          value={`${stats.avgRisk}`}
          sub="Score 0–100"
        />
        <KpiTile
          icon={<TrendingDown className="h-4 w-4" />}
          color="#E8B04C"
          eyebrow="En riesgo"
          value={`${(stats.moneyAtRisk / 100).toFixed(0)}€`}
          sub="Total disputas"
        />
        <KpiTile
          icon={<ShieldCheck className="h-4 w-4" />}
          color="#4DB87A"
          eyebrow="Prevenido este mes"
          value={`${(stats.preventedThisMonth / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
          sub="Fraude bloqueado"
        />
      </section>

      {/* Tabs */}
      <div className="flex items-end justify-between gap-4 border-b border-border">
        <div className="flex gap-1">
          <Tab active={tab === "queue"} onClick={() => setTab("queue")} icon={<ShieldAlert className="h-4 w-4" />}>
            Cola · {stats.openCount}
          </Tab>
          <Tab active={tab === "blacklists"} onClick={() => setTab("blacklists")} icon={<Ban className="h-4 w-4" />}>
            Listas
          </Tab>
          <Tab active={tab === "rules"} onClick={() => setTab("rules")} icon={<Shield className="h-4 w-4" />}>
            Reglas
          </Tab>
        </div>
      </div>

      {tab === "queue" && <FraudQueue cases={CASES} selectedId={selectedId} onSelect={setSelectedId} />}
      {tab === "blacklists" && <Blacklists />}
      {tab === "rules" && <Rules />}
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
    className="group relative inline-flex items-center gap-2 px-4 pb-3 pt-1 text-sm font-medium transition"
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
// Fraud queue + detail
// =============================================================

const FraudQueue = ({
  cases,
  selectedId,
  onSelect,
}: {
  cases: FraudCase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) => {
  const sorted = [...cases].sort((a, b) => b.riskScore - a.riskScore);
  const selected = sorted.find((c) => c.id === selectedId) ?? sorted[0] ?? null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
      {/* List */}
      <div className="space-y-2">
        {sorted.map((c) => (
          <CaseRow key={c.id} c={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
        ))}
      </div>
      {/* Detail */}
      {selected && <CaseDetail c={selected} />}
    </div>
  );
};

const CaseRow = ({
  c,
  active,
  onClick,
}: {
  c: FraudCase;
  active: boolean;
  onClick: () => void;
}) => {
  const kind = KIND_CONFIG[c.kind];
  const sev = SEV_CONFIG[c.severity];
  const status = STATUS_CONFIG[c.status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
      style={{
        background: active ? "rgba(232,84,42,0.06)" : "rgba(255,255,255,0.02)",
        borderColor: active ? "rgba(232,84,42,0.5)" : "rgba(244,238,226,0.1)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
            style={{
              background: `linear-gradient(180deg, ${kind.color}DD 0%, ${kind.color} 100%)`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 10px -3px ${kind.color}99`,
            }}
          >
            {kind.icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] uppercase"
                style={{ ...mono, letterSpacing: "0.18em", color: kind.color }}
              >
                {kind.label}
              </span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                style={{
                  ...mono,
                  letterSpacing: "0.16em",
                  background: `${sev.color}22`,
                  color: sev.color,
                }}
              >
                {sev.label}
              </span>
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">
              {c.title}
            </div>
            {c.partnerName && (
              <div
                className="mt-0.5 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.16em" }}
              >
                {c.partnerName}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[9px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.14em" }}
          >
            Risk
          </div>
          <div
            className="mt-0.5 text-base font-bold"
            style={{
              ...mono,
              color: c.riskScore >= 80 ? "#B8381A" : c.riskScore >= 50 ? "#E8B04C" : "#4DB87A",
            }}
          >
            {c.riskScore}
          </div>
        </div>
      </div>
      <div
        className="mt-3 flex items-center justify-between text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.14em" }}
      >
        <span>{format(c.detectedAt, "d MMM · HH:mm", { locale: es })}</span>
        <span style={{ color: status.color }}>{status.label}</span>
      </div>
    </button>
  );
};

const CaseDetail = ({ c }: { c: FraudCase }) => {
  const kind = KIND_CONFIG[c.kind];
  const sev = SEV_CONFIG[c.severity];
  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 20px -10px rgba(0,0,0,0.5)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full"
        style={{ background: `${kind.color}22`, filter: "blur(80px)" }}
      />

      <header className="relative flex items-start justify-between gap-3">
        <div>
          <div
            className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase"
            style={{ ...mono, letterSpacing: "0.22em", color: kind.color }}
          >
            {kind.icon}
            {kind.label} · Caso {c.id.toUpperCase()}
          </div>
          <h3 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
            {c.title}
          </h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{c.description}</p>
        </div>
        <div
          className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-white"
          style={{
            background: c.riskScore >= 80
              ? "linear-gradient(180deg, #B8381A 0%, #6F1F08 100%)"
              : c.riskScore >= 50
              ? "linear-gradient(180deg, #E8B04C 0%, #A6781D 100%)"
              : "linear-gradient(180deg, #4DB87A 0%, #2D7A4F 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
          }}
        >
          <div className="text-center">
            <div className="text-[8px] uppercase opacity-80" style={mono}>Risk</div>
            <div className="text-2xl font-bold" style={mono}>{c.riskScore}</div>
          </div>
        </div>
      </header>

      <div className="relative mt-5 grid grid-cols-2 gap-2">
        {c.evidence.map((e) => (
          <div
            key={e.label}
            className="rounded-xl border border-border p-3"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <div
              className="text-[9px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              {e.label}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-foreground" style={mono}>
              {e.value}
            </div>
          </div>
        ))}
      </div>

      <footer className="relative mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button>
          <Ban className="mr-2 h-4 w-4" />
          Confirmar fraude
        </Button>
        <Button variant="outline">
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Falso positivo
        </Button>
        <Button variant="outline">
          <Gavel className="mr-2 h-4 w-4" />
          Escalar a legal
        </Button>
        <Button variant="ghost">
          <Mail className="mr-2 h-4 w-4" />
          Contactar partner
        </Button>
      </footer>
    </article>
  );
};

// =============================================================
// Blacklists
// =============================================================

const Blacklists = () => {
  const [tab, setTab] = useState<"emails" | "ips" | "cards" | "devices">("emails");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <ListTab id="emails" tab={tab} setTab={setTab} icon={<Mail className="h-3.5 w-3.5" />} label="Emails" count={12} />
        <ListTab id="ips" tab={tab} setTab={setTab} icon={<Globe className="h-3.5 w-3.5" />} label="IPs" count={28} />
        <ListTab id="cards" tab={tab} setTab={setTab} icon={<Ban className="h-3.5 w-3.5" />} label="Tarjetas" count={7} />
        <ListTab id="devices" tab={tab} setTab={setTab} icon={<Fingerprint className="h-3.5 w-3.5" />} label="Devices" count={19} />
      </div>

      <div
        className="rounded-2xl border border-border bg-card p-5"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-10 rounded-xl pl-9" placeholder="Buscar entrada en lista…" />
          </div>
          <Button>Añadir</Button>
        </div>

        <ul className="space-y-2">
          {(tab === "emails" ? FAKE_EMAILS : tab === "ips" ? FAKE_IPS : tab === "cards" ? FAKE_CARDS : FAKE_DEVICES).map((item) => (
            <li
              key={item.value}
              className="flex items-center gap-3 rounded-xl border border-border p-3"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                style={{ background: "rgba(232,84,42,0.18)", color: "#FF7A4D" }}
              >
                <Ban className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground" style={mono}>
                  {item.value}
                </div>
                <div
                  className="text-[10px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.16em" }}
                >
                  Bloqueado · {item.since} · {item.reason}
                </div>
              </div>
              <Button variant="ghost" size="sm">
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const ListTab = ({
  id,
  tab,
  setTab,
  icon,
  label,
  count,
}: {
  id: "emails" | "ips" | "cards" | "devices";
  tab: "emails" | "ips" | "cards" | "devices";
  setTab: (t: "emails" | "ips" | "cards" | "devices") => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) => {
  const active = tab === id;
  return (
    <button
      type="button"
      onClick={() => setTab(id)}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition"
      style={{
        background: active ? "rgba(232,84,42,0.18)" : "rgba(255,255,255,0.02)",
        borderColor: active ? "rgba(232,84,42,0.5)" : "rgba(244,238,226,0.1)",
        color: active ? "#FF7A4D" : "#C9BFA8",
      }}
    >
      {icon}
      {label}
      <span
        className="rounded-full px-1.5 py-0.5 text-[10px]"
        style={{
          ...mono,
          letterSpacing: "0.06em",
          background: active ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.04)",
        }}
      >
        {count}
      </span>
    </button>
  );
};

const FAKE_EMAILS = [
  { value: "fraud_user_01@temp-mail.org", since: "12 mar", reason: "3 chargebacks" },
  { value: "spam-tickets@guerrillamail.com", since: "8 mar", reason: "Velocidad anómala" },
  { value: "bot.account+42@protonmail.com", since: "1 mar", reason: "Sospecha bot" },
];
const FAKE_IPS = [
  { value: "185.220.101.42", since: "14 mar", reason: "Tor exit node" },
  { value: "5.62.62.*", since: "9 mar", reason: "VPN abuso" },
];
const FAKE_CARDS = [{ value: "459478 ••• 8821", since: "Hoy", reason: "Velocity 4 cuentas/1h" }];
const FAKE_DEVICES = [
  { value: "fp_2d8a91b…f4e2", since: "11 mar", reason: "Múltiples cuentas" },
];

// =============================================================
// Rules engine
// =============================================================

const RULES = [
  { name: "QR usado >1 vez en 60s", color: "#E8542A", action: "Alerta + escalar", active: true },
  { name: "Tarjeta en >3 cuentas / 24h", color: "#B8381A", action: "Bloquear compra", active: true },
  { name: "RRPP con cancel > 20%", color: "#E8B04C", action: "Pausa preventiva", active: true },
  { name: "Compra desde Tor", color: "#E8542A", action: "Requiere 3D Secure", active: true },
  { name: "Email +alias usado >5 veces", color: "#8A8275", action: "Alerta", active: false },
];

const Rules = () => (
  <div className="space-y-3">
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
            Reglas activas
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            Motor de detección
          </h3>
        </div>
        <Button>Nueva regla</Button>
      </div>
    </div>

    <div className="space-y-2">
      {RULES.map((r) => (
        <article
          key={r.name}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
          style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
        >
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
            style={{
              background: `linear-gradient(180deg, ${r.color}DD 0%, ${r.color} 100%)`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 10px -3px ${r.color}88`,
            }}
          >
            <Shield className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{r.name}</div>
            <div
              className="mt-0.5 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              {r.action}
            </div>
          </div>
          <span
            className="rounded-full px-2 py-0.5 text-[9px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.16em",
              background: r.active ? "rgba(77,184,122,0.18)" : "rgba(140,140,140,0.12)",
              color: r.active ? "#4DB87A" : "#8A8275",
            }}
          >
            {r.active ? "Activa" : "Inactiva"}
          </span>
        </article>
      ))}
    </div>
  </div>
);

// =============================================================
// Shared KPI
// =============================================================

const KpiTile = ({
  icon,
  color,
  eyebrow,
  value,
  sub,
  pulse,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  sub: string;
  pulse?: boolean;
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
    <div className="relative flex items-center justify-between">
      <div
        className="inline-flex items-center gap-1.5 text-[10px] uppercase"
        style={{ ...mono, letterSpacing: "0.18em", color }}
      >
        {icon}
        {eyebrow}
      </div>
      {pulse && (
        <span className="relative inline-flex h-1.5 w-1.5">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
            style={{ background: color }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
          />
        </span>
      )}
    </div>
    <div
      className="relative mt-3 text-2xl font-bold tracking-tight text-foreground md:text-3xl"
      style={mono}
    >
      {value}
    </div>
    <div
      className="relative mt-1 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.14em" }}
    >
      {sub}
    </div>
  </div>
);

export default TrustSafetyCenter;

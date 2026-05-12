import { useMemo, useState } from "react";
import {
  Award,
  Copy as CopyIcon,
  ExternalLink,
  Globe2,
  Link as LinkIcon,
  Megaphone,
  MoreVertical,
  Plus,
  Settings,
  Sparkles,
  Store,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// Channels data model (demo)
// =============================================================

type ChannelKind = "web" | "instagram" | "rrpp" | "reseller" | "embed" | "affiliate";

interface Channel {
  id: string;
  kind: ChannelKind;
  name: string;
  sold: number;
  revenueCents: number;
  commission: number; // 0-1
  active: boolean;
  meta?: string;
}

const channelKindConfig: Record<
  ChannelKind,
  { label: string; icon: React.ReactNode; color: string; description: string }
> = {
  web: { label: "Web pública", icon: <Globe2 className="h-4 w-4" />, color: "#FF7A4D", description: "Tu página de venta directa" },
  instagram: { label: "Instagram", icon: <Megaphone className="h-4 w-4" />, color: "#E8542A", description: "Link in bio + stories" },
  rrpp: { label: "Red RRPP", icon: <Users className="h-4 w-4" />, color: "#4DB87A", description: "Promotores con código" },
  reseller: { label: "Revendedores", icon: <Store className="h-4 w-4" />, color: "#E8B04C", description: "Hoteles · agencias · conserjes" },
  embed: { label: "Widget embed", icon: <LinkIcon className="h-4 w-4" />, color: "#5C544A", description: "Iframe en tu web externa" },
  affiliate: { label: "Afiliados", icon: <Award className="h-4 w-4" />, color: "#B8381A", description: "Influencers tracked por código" },
};

const DEMO_CHANNELS: Channel[] = [
  { id: "ch-1", kind: "web", name: "pacha-ibiza.pasify.es", sold: 487, revenueCents: 7305_00, commission: 0, active: true },
  { id: "ch-2", kind: "instagram", name: "@pachaibiza", sold: 142, revenueCents: 2130_00, commission: 0, active: true, meta: "12K seguidores" },
  { id: "ch-3", kind: "rrpp", name: "Red interna · 14 RRPP", sold: 268, revenueCents: 4020_00, commission: 0.1, active: true },
  { id: "ch-4", kind: "reseller", name: "Hotel Ushuaïa", sold: 64, revenueCents: 960_00, commission: 0.15, active: true, meta: "Concierge → cliente VIP" },
  { id: "ch-5", kind: "embed", name: "Widget · pachaibiza.com", sold: 92, revenueCents: 1380_00, commission: 0, active: true },
  { id: "ch-6", kind: "affiliate", name: "@martagomez (124K)", sold: 38, revenueCents: 570_00, commission: 0.08, active: true, meta: "Código MARTA10" },
];

interface Rrpp {
  id: string;
  name: string;
  avatarColor: string;
  code: string;
  sold: number;
  commissionCents: number;
  pendingPayoutCents: number;
  joinedAt: string;
  status: "active" | "paused" | "blocked";
}

const DEMO_RRPP: Rrpp[] = [
  { id: "r-1", name: "Carla Sánchez", avatarColor: "#FF7A4D", code: "CARLA10", sold: 38, commissionCents: 11400, pendingPayoutCents: 11400, joinedAt: "2025-11-12", status: "active" },
  { id: "r-2", name: "Diego Reyes", avatarColor: "#E8542A", code: "DIEGO15", sold: 27, commissionCents: 8100, pendingPayoutCents: 8100, joinedAt: "2025-09-03", status: "active" },
  { id: "r-3", name: "Lucía García", avatarColor: "#B8381A", code: "LUCIA12", sold: 19, commissionCents: 5700, pendingPayoutCents: 0, joinedAt: "2025-12-01", status: "active" },
  { id: "r-4", name: "Pablo López", avatarColor: "#E8B04C", code: "PABLO8", sold: 14, commissionCents: 4200, pendingPayoutCents: 4200, joinedAt: "2025-10-19", status: "active" },
  { id: "r-5", name: "Alba Martínez", avatarColor: "#4DB87A", code: "ALBA20", sold: 11, commissionCents: 3300, pendingPayoutCents: 0, joinedAt: "2026-01-04", status: "paused" },
  { id: "r-6", name: "Mateo Fernández", avatarColor: "#5C544A", code: "MATEO10", sold: 5, commissionCents: 1500, pendingPayoutCents: 0, joinedAt: "2026-02-18", status: "active" },
];

// =============================================================
// PartnerSalesChannels
// =============================================================

export const PartnerSalesChannels = () => {
  const [tab, setTab] = useState<"channels" | "rrpp">("channels");

  const totalRevenue = DEMO_CHANNELS.reduce((s, c) => s + c.revenueCents, 0);
  const totalSold = DEMO_CHANNELS.reduce((s, c) => s + c.sold, 0);
  const totalCommissions = DEMO_RRPP.reduce((s, r) => s + r.commissionCents, 0);
  const pendingPayouts = DEMO_RRPP.reduce((s, r) => s + r.pendingPayoutCents, 0);

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile icon={<TrendingUp className="h-4 w-4" />} color="#FF7A4D" eyebrow="Vendido total" value={totalSold.toString()} sub={`Todos los canales`} />
        <KpiTile icon={<Globe2 className="h-4 w-4" />} color="#E8542A" eyebrow="Recaudado" value={`${(totalRevenue / 100).toFixed(0)}€`} sub={`${DEMO_CHANNELS.filter((c) => c.active).length} canales activos`} />
        <KpiTile icon={<Users className="h-4 w-4" />} color="#4DB87A" eyebrow="RRPP activos" value={DEMO_RRPP.filter((r) => r.status === "active").length.toString()} sub={`${DEMO_RRPP.length} en total`} />
        <KpiTile icon={<Award className="h-4 w-4" />} color="#E8B04C" eyebrow="Comisiones" value={`${(totalCommissions / 100).toFixed(0)}€`} sub={`${(pendingPayouts / 100).toFixed(0)}€ pendientes`} />
      </section>

      {/* Tabs */}
      <div className="flex items-end justify-between gap-4 border-b border-border">
        <div className="flex gap-1">
          <TabButton active={tab === "channels"} onClick={() => setTab("channels")} icon={<Globe2 className="h-4 w-4" />}>
            Canales
          </TabButton>
          <TabButton active={tab === "rrpp"} onClick={() => setTab("rrpp")} icon={<Users className="h-4 w-4" />}>
            Red RRPP
          </TabButton>
        </div>
      </div>

      {tab === "channels" && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {DEMO_CHANNELS.map((c) => (
            <ChannelCard key={c.id} channel={c} totalRevenue={totalRevenue} />
          ))}
        </section>
      )}

      {tab === "rrpp" && <RrppTable rrpp={DEMO_RRPP} />}
    </div>
  );
};

const TabButton = ({
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

const ChannelCard = ({ channel, totalRevenue }: { channel: Channel; totalRevenue: number }) => {
  const config = channelKindConfig[channel.kind];
  const sharePct = totalRevenue > 0 ? (channel.revenueCents / totalRevenue) * 100 : 0;
  const { toast } = useToast();
  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 md:p-5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full"
        style={{ background: `${config.color}26`, filter: "blur(28px)" }}
      />
      <header className="relative flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
            style={{
              background: `linear-gradient(180deg, ${config.color}DD 0%, ${config.color} 100%)`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px -4px ${config.color}99`,
            }}
          >
            {config.icon}
          </div>
          <div className="min-w-0">
            <div
              className="text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.2em", color: config.color }}
            >
              {config.label}
            </div>
            <div className="truncate text-base font-semibold text-foreground">{channel.name}</div>
            {channel.meta && (
              <div className="text-[11px] text-muted-foreground" style={mono}>
                {channel.meta}
              </div>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            navigator.clipboard?.writeText(channel.name).catch(() => null);
            toast({ title: "Copiado", description: channel.name });
          }}
        >
          <CopyIcon className="h-4 w-4" />
        </Button>
      </header>

      <div className="relative mt-4 grid grid-cols-3 gap-2">
        <Stat label="Vendido" value={channel.sold.toString()} />
        <Stat label="Recaudado" value={`${(channel.revenueCents / 100).toFixed(0)}€`} />
        <Stat label="% del total" value={`${sharePct.toFixed(0)}%`} />
      </div>

      <div className="relative mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${sharePct}%`,
            background: `linear-gradient(90deg, ${config.color}88 0%, ${config.color} 100%)`,
            boxShadow: `0 0 12px ${config.color}88`,
          }}
        />
      </div>

      {channel.commission > 0 && (
        <div
          className="relative mt-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase"
          style={{
            ...mono,
            letterSpacing: "0.18em",
            background: "rgba(232,176,76,0.18)",
            color: "#E8B04C",
          }}
        >
          <Award className="h-3 w-3" />
          Comisión {(channel.commission * 100).toFixed(0)}%
        </div>
      )}
    </article>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div
      className="text-[9px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      {label}
    </div>
    <div className="mt-0.5 text-base font-bold text-foreground" style={mono}>
      {value}
    </div>
  </div>
);

// =============================================================
// RRPP table
// =============================================================

const RrppTable = ({ rrpp }: { rrpp: Rrpp[] }) => {
  const [inviteOpen, setInviteOpen] = useState(false);
  const sorted = useMemo(() => [...rrpp].sort((a, b) => b.sold - a.sold), [rrpp]);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <span className="inline-block h-px w-5 bg-orange-500/70" />
          Top RRPP · {sorted.length}
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="mr-2 h-3.5 w-3.5" />
              Invitar RRPP
            </Button>
          </DialogTrigger>
          <InviteRrppDialog onClose={() => setInviteOpen(false)} />
        </Dialog>
      </div>

      <div className="space-y-2">
        {sorted.map((r, idx) => (
          <RrppRow key={r.id} rrpp={r} rank={idx + 1} top={idx < 3} />
        ))}
      </div>
    </section>
  );
};

const RrppRow = ({ rrpp, rank, top }: { rrpp: Rrpp; rank: number; top: boolean }) => {
  const { toast } = useToast();
  return (
    <article
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 md:p-4"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      {/* Rank */}
      <div
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
        style={{
          background: top
            ? "linear-gradient(180deg, #FF7A4D 0%, #B8381A 100%)"
            : "rgba(255,255,255,0.04)",
          color: top ? "#fff" : "#8A8275",
        }}
      >
        {top ? <Trophy className="h-4 w-4" /> : <span className="text-sm font-bold" style={mono}>{rank.toString().padStart(2, "0")}</span>}
      </div>

      {/* Avatar + name */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
          style={{
            background: `linear-gradient(135deg, ${rrpp.avatarColor} 0%, ${rrpp.avatarColor}AA 100%)`,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {rrpp.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-foreground">{rrpp.name}</div>
            {rrpp.status === "paused" && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                style={{
                  ...mono,
                  letterSpacing: "0.16em",
                  background: "rgba(232,176,76,0.18)",
                  color: "#E8B04C",
                }}
              >
                Pausado
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(rrpp.code).catch(() => null);
              toast({ title: "Código copiado", description: rrpp.code });
            }}
            className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-muted-foreground transition hover:text-orange-500"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            <CopyIcon className="h-2.5 w-2.5" />
            {rrpp.code}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="hidden grid-cols-2 gap-x-4 text-right sm:grid">
        <div>
          <div
            className="text-[9px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.14em" }}
          >
            Vendido
          </div>
          <div className="mt-0.5 text-base font-bold text-foreground" style={mono}>
            {rrpp.sold}
          </div>
        </div>
        <div>
          <div
            className="text-[9px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.14em" }}
          >
            Comisión
          </div>
          <div className="mt-0.5 text-base font-bold" style={{ ...mono, color: rrpp.pendingPayoutCents > 0 ? "#E8B04C" : "#4DB87A" }}>
            {(rrpp.commissionCents / 100).toFixed(0)}€
          </div>
        </div>
      </div>

      <Button variant="ghost" size="icon" aria-label="Más acciones">
        <MoreVertical className="h-4 w-4" />
      </Button>
    </article>
  );
};

const InviteRrppDialog = ({ onClose }: { onClose: () => void }) => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [commission, setCommission] = useState("10");
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Invitar nuevo RRPP</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Le mandaremos un email con su código personalizado y un enlace para que se descargue la app de Pasify RRPP.
        </p>
        <div>
          <Label className="text-xs">Email del promotor</Label>
          <Input
            className="mt-1.5 h-10 rounded-xl"
            type="email"
            placeholder="rrpp@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Código sugerido</Label>
            <Input
              className="mt-1.5 h-10 rounded-xl uppercase"
              placeholder="NOMBRE10"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <Label className="text-xs">Comisión (%)</Label>
            <Input
              className="mt-1.5 h-10 rounded-xl"
              type="number"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          onClick={() => {
            if (!email) {
              toast({ title: "Falta email", variant: "destructive" });
              return;
            }
            toast({
              title: "Invitación enviada",
              description: `Hemos mandado el enlace a ${email}`,
            });
            onClose();
          }}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Enviar invitación
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

// =============================================================
// Subcomponents
// =============================================================

const KpiTile = ({
  icon,
  color,
  eyebrow,
  value,
  sub,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  sub: string;
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
    <div
      className="relative mt-1 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.14em" }}
    >
      {sub}
    </div>
  </div>
);

export default PartnerSalesChannels;

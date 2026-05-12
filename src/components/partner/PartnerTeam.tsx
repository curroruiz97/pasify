import { useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Coins,
  GraduationCap,
  Mail,
  Phone,
  Plus,
  ScanLine,
  Shield,
  Star,
  UserPlus,
  Users,
  Wine,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

type Role = "door" | "host" | "barman" | "rrpp" | "box_office" | "manager";

interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roles: Role[];
  hourlyCents: number;
  avatarColor: string;
  hoursThisMonth: number;
  rating: number;
  joinedAt: string;
  shifts: Array<{ id: string; date: string; role: Role; hours: number; closed: boolean }>;
}

const STAFF: StaffMember[] = [
  {
    id: "u-1",
    firstName: "Carla",
    lastName: "Sánchez",
    email: "carla@pacha.es",
    phone: "+34 612 345 678",
    roles: ["host", "manager"],
    hourlyCents: 1400,
    avatarColor: "#FF7A4D",
    hoursThisMonth: 64,
    rating: 4.9,
    joinedAt: "2025-04-12",
    shifts: [
      { id: "s-1", date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), role: "host", hours: 8, closed: false },
      { id: "s-2", date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), role: "manager", hours: 6, closed: false },
    ],
  },
  {
    id: "u-2",
    firstName: "Diego",
    lastName: "Reyes",
    email: "diego@pacha.es",
    phone: "+34 622 938 119",
    roles: ["door", "box_office"],
    hourlyCents: 1200,
    avatarColor: "#E8542A",
    hoursThisMonth: 48,
    rating: 4.6,
    joinedAt: "2025-09-03",
    shifts: [
      { id: "s-3", date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), role: "door", hours: 8, closed: false },
    ],
  },
  {
    id: "u-3",
    firstName: "Lucía",
    lastName: "García",
    email: "lucia@pacha.es",
    phone: "+34 600 471 829",
    roles: ["barman"],
    hourlyCents: 1300,
    avatarColor: "#4DB87A",
    hoursThisMonth: 72,
    rating: 5.0,
    joinedAt: "2024-11-20",
    shifts: [
      { id: "s-4", date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), role: "barman", hours: 7, closed: false },
      { id: "s-5", date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), role: "barman", hours: 7, closed: false },
    ],
  },
  {
    id: "u-4",
    firstName: "Pablo",
    lastName: "López",
    email: "pablo@pacha.es",
    phone: "+34 633 882 154",
    roles: ["rrpp"],
    hourlyCents: 0,
    avatarColor: "#E8B04C",
    hoursThisMonth: 0,
    rating: 4.3,
    joinedAt: "2025-10-19",
    shifts: [],
  },
  {
    id: "u-5",
    firstName: "Alba",
    lastName: "Martínez",
    email: "alba@pacha.es",
    phone: "+34 644 290 188",
    roles: ["host", "barman"],
    hourlyCents: 1350,
    avatarColor: "#B8381A",
    hoursThisMonth: 56,
    rating: 4.8,
    joinedAt: "2025-12-04",
    shifts: [
      { id: "s-6", date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), role: "host", hours: 8, closed: false },
    ],
  },
];

const ROLE_CONFIG: Record<Role, { label: string; icon: React.ReactNode; color: string }> = {
  door: { label: "Puerta", icon: <ScanLine className="h-3 w-3" />, color: "#FF7A4D" },
  host: { label: "Host VIP", icon: <Star className="h-3 w-3" />, color: "#E8B04C" },
  barman: { label: "Barra", icon: <Wine className="h-3 w-3" />, color: "#B8381A" },
  rrpp: { label: "RRPP", icon: <Users className="h-3 w-3" />, color: "#4DB87A" },
  box_office: { label: "Taquilla", icon: <CalendarIcon className="h-3 w-3" />, color: "#E8542A" },
  manager: { label: "Manager", icon: <Shield className="h-3 w-3" />, color: "#FF7A4D" },
};

export const PartnerTeam = () => {
  const [tab, setTab] = useState<"team" | "schedule" | "payroll">("team");

  const totalHours = STAFF.reduce((s, u) => s + u.hoursThisMonth, 0);
  const totalPayroll = STAFF.reduce((s, u) => s + u.hoursThisMonth * u.hourlyCents, 0);
  const avgRating =
    STAFF.length > 0
      ? STAFF.reduce((s, u) => s + u.rating, 0) / STAFF.length
      : 0;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile icon={<Users className="h-4 w-4" />} color="#FF7A4D" eyebrow="Plantilla" value={STAFF.length.toString()} sub={`${STAFF.filter((s) => s.shifts.length > 0).length} con turno`} />
        <KpiTile icon={<Clock className="h-4 w-4" />} color="#E8542A" eyebrow="Horas mes" value={totalHours.toString()} sub="Mes actual" />
        <KpiTile icon={<Coins className="h-4 w-4" />} color="#E8B04C" eyebrow="Nómina mes" value={`${(totalPayroll / 100).toFixed(0)}€`} sub="Prevista bruta" />
        <KpiTile icon={<Star className="h-4 w-4" />} color="#4DB87A" eyebrow="Rating medio" value={avgRating.toFixed(1)} sub="Sobre 5.0" />
      </section>

      <div className="flex items-end justify-between gap-4 border-b border-border">
        <div className="flex gap-1">
          <Tab active={tab === "team"} onClick={() => setTab("team")} icon={<Users className="h-4 w-4" />}>
            Plantilla
          </Tab>
          <Tab active={tab === "schedule"} onClick={() => setTab("schedule")} icon={<CalendarIcon className="h-4 w-4" />}>
            Turnos
          </Tab>
          <Tab active={tab === "payroll"} onClick={() => setTab("payroll")} icon={<Coins className="h-4 w-4" />}>
            Nómina
          </Tab>
        </div>
      </div>

      {tab === "team" && <TeamList />}
      {tab === "schedule" && <ScheduleView />}
      {tab === "payroll" && <PayrollView />}
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
// Team list
// =============================================================

const TeamList = () => {
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <span className="inline-block h-px w-5 bg-orange-500/70" />
          {STAFF.length} personas
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="mr-2 h-3.5 w-3.5" />
              Invitar
            </Button>
          </DialogTrigger>
          <InviteDialog onClose={() => setInviteOpen(false)} />
        </Dialog>
      </div>

      <div className="space-y-2">
        {STAFF.map((u) => (
          <StaffRow key={u.id} member={u} />
        ))}
      </div>
    </section>
  );
};

const StaffRow = ({ member }: { member: StaffMember }) => (
  <article
    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 md:p-4"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
  >
    <div
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white"
      style={{
        background: `linear-gradient(135deg, ${member.avatarColor} 0%, ${member.avatarColor}AA 100%)`,
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {member.firstName[0]}
      {member.lastName[0]}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {member.firstName} {member.lastName}
        </span>
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-amber-400"
          style={mono}
        >
          <Star className="h-3 w-3 fill-current" />
          {member.rating.toFixed(1)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {member.roles.map((r) => {
          const cfg = ROLE_CONFIG[r];
          return (
            <span
              key={r}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.16em",
                background: `${cfg.color}22`,
                color: cfg.color,
              }}
            >
              {cfg.icon}
              {cfg.label}
            </span>
          );
        })}
      </div>
    </div>
    <div className="hidden grid-cols-2 gap-x-4 text-right sm:grid">
      <div>
        <div
          className="text-[9px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.14em" }}
        >
          Horas mes
        </div>
        <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
          {member.hoursThisMonth}
        </div>
      </div>
      <div>
        <div
          className="text-[9px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.14em" }}
        >
          Tarifa/h
        </div>
        <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
          {member.hourlyCents > 0 ? `${(member.hourlyCents / 100).toFixed(0)}€` : "—"}
        </div>
      </div>
    </div>
    <Button variant="ghost" size="icon" aria-label="Más">
      <Mail className="h-4 w-4" />
    </Button>
  </article>
);

// =============================================================
// Schedule view — next 7 days
// =============================================================

const ScheduleView = () => {
  const today = new Date();
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Array<{ user: StaffMember; shift: StaffMember["shifts"][number] }>>();
    STAFF.forEach((u) => {
      u.shifts.forEach((s) => {
        const key = format(new Date(s.date), "yyyy-MM-dd");
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ user: u, shift: s });
      });
    });
    return map;
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <CalendarIcon className="h-3 w-3" />
          Próximos 7 días
        </div>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-3.5 w-3.5" />
          Programar turno
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const shifts = shiftsByDay.get(key) ?? [];
          const isToday = format(d, "yyyy-MM-dd") === format(today, "yyyy-MM-dd");
          return (
            <article
              key={key}
              className="rounded-2xl border border-border bg-card p-4"
              style={{
                boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
                borderColor: isToday ? "rgba(232,84,42,0.4)" : undefined,
                background: isToday ? "rgba(232,84,42,0.04)" : undefined,
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.18em" }}
                  >
                    {format(d, "EEEE", { locale: es })}
                  </div>
                  <div
                    className="mt-0.5 text-lg font-bold tracking-tight text-foreground"
                    style={mono}
                  >
                    {format(d, "d MMM", { locale: es })}
                    {isToday && (
                      <span
                        className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                        style={{
                          ...mono,
                          letterSpacing: "0.18em",
                          background: "rgba(232,84,42,0.2)",
                          color: "#FF7A4D",
                        }}
                      >
                        Hoy
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className="text-[10px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.16em" }}
                >
                  {shifts.length} turnos
                </div>
              </div>
              {shifts.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {shifts.map(({ user, shift }) => {
                    const cfg = ROLE_CONFIG[shift.role];
                    return (
                      <li key={shift.id} className="flex items-center gap-2.5">
                        <div
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white"
                          style={{
                            background: `linear-gradient(135deg, ${user.avatarColor} 0%, ${user.avatarColor}AA 100%)`,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {user.firstName[0]}
                          {user.lastName[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">
                            {user.firstName} {user.lastName}
                          </div>
                          <div
                            className="text-[10px] uppercase"
                            style={{ ...mono, letterSpacing: "0.16em", color: cfg.color }}
                          >
                            {cfg.label} · {shift.hours}h
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p
                  className="mt-3 text-[10px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.16em" }}
                >
                  Sin turnos asignados
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};

// =============================================================
// Payroll view
// =============================================================

const PayrollView = () => {
  const rows = STAFF.map((u) => ({
    user: u,
    grossCents: u.hoursThisMonth * u.hourlyCents,
  }));
  const total = rows.reduce((s, r) => s + r.grossCents, 0);
  return (
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
              <Coins className="h-3 w-3" />
              Cierre de mes
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {(total / 100).toFixed(0)}€{" "}
              <span className="text-muted-foreground" style={serif}>
                a liquidar
              </span>
            </h3>
          </div>
          <Button>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Liquidar todo
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map(({ user, grossCents }) => (
          <article
            key={user.id}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 md:p-4"
            style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
          >
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
              style={{
                background: `linear-gradient(135deg, ${user.avatarColor} 0%, ${user.avatarColor}AA 100%)`,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {user.firstName[0]}
              {user.lastName[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {user.firstName} {user.lastName}
              </div>
              <div
                className="text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.16em" }}
              >
                {user.hoursThisMonth}h ·{" "}
                {user.hourlyCents > 0 ? `${(user.hourlyCents / 100).toFixed(2)}€/h` : "Comisión"}
              </div>
            </div>
            <div className="text-right">
              <div
                className="text-[9px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.14em" }}
              >
                A pagar
              </div>
              <div className="mt-0.5 text-base font-bold text-foreground" style={mono}>
                {(grossCents / 100).toFixed(2)}€
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

// =============================================================
// Invite dialog
// =============================================================

const InviteDialog = ({ onClose }: { onClose: () => void }) => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("door");
  const [hourly, setHourly] = useState("12");
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Invitar a tu equipo</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Le enviaremos un email para descargar la app Pasify Staff con su rol pre-configurado.
        </p>
        <div>
          <Label className="text-xs">Email</Label>
          <Input
            className="mt-1.5 h-10 rounded-xl"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="mt-1.5 h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="door">Puerta</SelectItem>
                <SelectItem value="host">Host VIP</SelectItem>
                <SelectItem value="barman">Barra</SelectItem>
                <SelectItem value="rrpp">RRPP</SelectItem>
                <SelectItem value="box_office">Taquilla</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tarifa €/h</Label>
            <Input
              className="mt-1.5 h-10 rounded-xl"
              type="number"
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
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
              description: `${email} recibirá las instrucciones en breve`,
            });
            onClose();
          }}
        >
          <GraduationCap className="mr-2 h-4 w-4" />
          Enviar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

// =============================================================
// Shared KPI
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

export default PartnerTeam;

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import WebhookLogsScreen from "./WebhookLogsScreen";
import { FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  CreditCard,
  Ban,
  Mail,
  Building2,
  Calendar,
  Search,
  RefreshCw,
  Gift,
  ShieldCheck,
  Clock,
  Plus,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";

// Post Fase 3: partner_subscriptions está vinculada por org_id (no partner_id).
// El "owner" del partner se resuelve via organizations.owner_id → profiles.
// `granted_by_admin` (boolean) deja de existir como columna — se deriva de
// `admin_granted_until > now()` (col añadida en mig 0034).
// `admin_note` se renombra a `admin_grant_note` (mig 0034).
// `monthly_amount_cents` desaparece — el MRR se computa via subscription_plans.
interface SubRow {
  id: string;
  org_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  plan_code: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  admin_granted_until: string | null;
  admin_grant_note: string | null;
  created_at: string;
  /** Computed: !!admin_granted_until && fecha futura */
  granted_by_admin: boolean;
  /** Monthly amount derivado del plan (fallback 2999 cents). */
  monthly_amount_cents: number | null;
  organizations: {
    id: string;
    name: string | null;
    city: string | null;
    owner_id: string;
  } | null;
  profiles: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    business_name: string | null;
    profile_image_url: string | null;
    business_city: string | null;
  } | null;
}

interface PartnerCandidate {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  profile_image_url: string | null;
}

// Calcola lo stato "logico" mostrato all'admin
type LogicalStatus = "admin_free" | "trial" | "active" | "past_due" | "canceled" | "expired" | "none" | "other";

const getLogicalStatus = (sub: SubRow): LogicalStatus => {
  const now = Date.now();
  // Admin grant tiene prioridad (es el override explícito de plataforma).
  if (sub.admin_granted_until) {
    return new Date(sub.admin_granted_until).getTime() > now ? "admin_free" : "expired";
  }
  if (sub.status === "active") return "active";
  if (sub.status === "trialing") {
    if (sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > now) return "trial";
    return "expired";
  }
  if (sub.status === "past_due") return "past_due";
  if (sub.status === "cancelled" || sub.status === "canceled") return "canceled";
  return "other";
};

const STATUS_META: Record<LogicalStatus, { label: string; cls: string }> = {
  admin_free: {
    label: "Gratis (admin)",
    cls: "bg-violet-50 text-violet-700 border-violet-200",
  },
  trial: {
    label: "Prueba",
    cls: "bg-sky-50 text-sky-700 border-sky-200",
  },
  active: {
    label: "Activa",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  past_due: {
    label: "Pago pendiente",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  canceled: {
    label: "Cancelada",
    cls: "bg-slate-100 text-slate-700 border-slate-200",
  },
  expired: {
    label: "Caducada",
    cls: "bg-rose-50 text-rose-700 border-rose-200",
  },
  none: {
    label: "Sin plan",
    cls: "bg-slate-100 text-slate-600 border-slate-200",
  },
  other: {
    label: "Otro",
    cls: "bg-slate-100 text-slate-700 border-slate-200",
  },
};

const SubscriptionsManagement = () => {
  const { toast } = useToast();
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<SubRow | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SubRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Grant dialog
  const [grantOpen, setGrantOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [grantSearch, setGrantSearch] = useState("");
  const [grantCandidates, setGrantCandidates] = useState<PartnerCandidate[]>([]);
  const [grantSearching, setGrantSearching] = useState(false);
  const [grantSelected, setGrantSelected] = useState<PartnerCandidate | null>(null);
  const [grantDays, setGrantDays] = useState<string>("");
  const [grantNote, setGrantNote] = useState<string>("");
  const [granting, setGranting] = useState(false);

  const fetchSubs = async () => {
    setLoading(true);
    try {
      // Three-step fetch (Fase 3): partner_subscriptions → organizations →
      // profiles. La cadena de FK es: partner_subscriptions.org_id →
      // organizations.id; organizations.owner_id → profiles.id. Hacemos el
      // JOIN en cliente para evitar pegamento PostgREST.
      const { data: subRows, error: subErr } = await supabase
        .from("partner_subscriptions")
        .select(
          `id, org_id, stripe_customer_id, stripe_subscription_id, status, plan_code,
           current_period_end, trial_ends_at, cancel_at_period_end,
           admin_granted_until, admin_grant_note, created_at`
        )
        .order("created_at", { ascending: false });
      if (subErr) throw subErr;
      const rows = subRows ?? [];

      const orgIds = [...new Set(rows.map((r) => r.org_id).filter(Boolean))];
      const orgMap = new Map<string, SubRow["organizations"]>();
      const ownerIdByOrg = new Map<string, string>();
      if (orgIds.length > 0) {
        const { data: orgs, error: orgErr } = await supabase
          .from("organizations")
          .select("id, name, city, owner_id")
          .in("id", orgIds);
        if (orgErr) throw orgErr;
        for (const o of orgs ?? []) {
          orgMap.set(o.id, o as SubRow["organizations"]);
          ownerIdByOrg.set(o.id, o.owner_id);
        }
      }

      const ownerIds = [...new Set([...ownerIdByOrg.values()])];
      const profilesMap = new Map<string, SubRow["profiles"]>();
      if (ownerIds.length > 0) {
        const { data: profs, error: profErr } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, business_name, business_city")
          .in("id", ownerIds);
        if (profErr) throw profErr;
        for (const p of profs ?? []) {
          profilesMap.set(p.id, { ...p, profile_image_url: null } as SubRow["profiles"]);
        }
      }

      // Plan codes → monthly amount (subscription_plans).
      const planCodes = [...new Set(rows.map((r) => r.plan_code).filter(Boolean) as string[])];
      const planAmounts = new Map<string, number>();
      if (planCodes.length > 0) {
        const { data: plans } = await supabase
          .from("subscription_plans")
          .select("code, monthly_price_cents")
          .in("code", planCodes);
        for (const p of plans ?? []) {
          if (p.code && typeof p.monthly_price_cents === "number") {
            planAmounts.set(p.code, p.monthly_price_cents);
          }
        }
      }

      const now = Date.now();
      setSubs(
        rows.map((r) => {
          const owner = ownerIdByOrg.get(r.org_id);
          const profile = owner ? (profilesMap.get(owner) ?? null) : null;
          const grantedUntilMs = r.admin_granted_until
            ? new Date(r.admin_granted_until).getTime()
            : null;
          return {
            ...r,
            organizations: orgMap.get(r.org_id) ?? null,
            profiles: profile,
            granted_by_admin: !!grantedUntilMs && grantedUntilMs > now,
            monthly_amount_cents: r.plan_code ? (planAmounts.get(r.plan_code) ?? null) : null,
          } as SubRow;
        })
      );
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubs();
  }, []);

  const handleCancel = async () => {
    if (!cancelTarget?.stripe_subscription_id) return;
    setCanceling(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-cancel-partner-subscription", {
        body: {
          subscription_id: cancelTarget.stripe_subscription_id,
          immediate: false,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Suscripción cancelada",
        description: "Se cancelará al final del periodo actual de facturación.",
      });
      await fetchSubs();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCanceling(false);
      setCancelTarget(null);
    }
  };

  const handleResync = async () => {
    setResyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-resync-stripe-subs");
      if (error) throw error;
      const summary = data as { ok: boolean; total: number; inserted: number; updated: number; skipped: number };
      toast({
        title: "Sincronización completada",
        description: `${summary.inserted} nuevas · ${summary.updated} actualizadas · ${summary.skipped} omitidas`,
      });
      await fetchSubs();
    } catch (err: any) {
      toast({
        title: "Error en la sincronización",
        description: err?.message ?? "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setResyncing(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      // RPC de mig 0034: revoca admin_granted_until en partner_subscriptions
      // por org_id. La RPC legacy `admin_revoke_partner_access(_partner_id)`
      // (mig 0025) hace otra cosa: borra el rol partner del user. No es lo
      // que el botón "Revocar acceso gratuito" debería hacer.
      const { error } = await supabase.rpc("admin_revoke_partner_grant", {
        _org_id: revokeTarget.org_id,
      });
      if (error) throw error;
      toast({ title: "Acceso revocado", description: "El partner ya no tiene acceso gratuito." });
      await fetchSubs();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  };

  // Grant: ricerca partner (che non hanno già sub o che vuoi override)
  useEffect(() => {
    if (!grantOpen) return;
    const q = grantSearch.trim();
    let cancelled = false;
    const run = async () => {
      setGrantSearching(true);
      try {
        // Partner = user_roles.role='partner'
        let query = supabase
          .from("profiles")
          .select("id, email, first_name, last_name, business_name, profile_image_url, user_roles!inner(role)")
          .eq("user_roles.role", "partner")
          .limit(15);
        if (q) {
          query = query.or(
            `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,business_name.ilike.%${q}%`,
          );
        }
        const { data, error } = await query;
        if (error) throw error;
        if (!cancelled) setGrantCandidates((data || []) as unknown as PartnerCandidate[]);
      } catch (err: any) {
        if (!cancelled) toast({ title: "Error búsqueda", description: err.message, variant: "destructive" });
      } finally {
        if (!cancelled) setGrantSearching(false);
      }
    };
    const t = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [grantOpen, grantSearch, toast]);

  const resetGrantDialog = () => {
    setGrantOpen(false);
    setGrantSelected(null);
    setGrantSearch("");
    setGrantDays("");
    setGrantNote("");
  };

  const handleGrant = async () => {
    if (!grantSelected) return;
    setGranting(true);
    try {
      let until: string | null = null;
      if (grantDays.trim()) {
        const n = parseInt(grantDays, 10);
        if (!Number.isFinite(n) || n <= 0) throw new Error("Días inválidos");
        until = new Date(Date.now() + n * 86400000).toISOString();
      } else {
        // RPC requiere _until; "ilimitado" lo modelamos como +10 años.
        until = new Date(Date.now() + 10 * 365 * 86400000).toISOString();
      }
      // Resolver org_id del partner seleccionado (selectionado es profile.id =
      // organizations.owner_id por el flujo de RegisterPartner Fase 2).
      const { data: orgRow, error: orgErr } = await supabase
        .from("organizations")
        .select("id")
        .eq("owner_id", grantSelected.id)
        .limit(1)
        .maybeSingle();
      if (orgErr) throw orgErr;
      if (!orgRow?.id) throw new Error("Este partner no tiene organization. Pídele que complete el registro.");

      // RPC de mig 0034: admin_grant_partner_access_until(_org_id, _until, _note).
      const { error } = await supabase.rpc("admin_grant_partner_access_until", {
        _org_id: orgRow.id,
        _until: until,
        _note: grantNote || null,
      });
      if (error) throw error;
      toast({
        title: "Acceso concedido",
        description: until
          ? `Gratis hasta el ${new Date(until).toLocaleDateString("es-ES")}.`
          : "Acceso gratuito sin fecha límite.",
      });
      await fetchSubs();
      resetGrantDialog();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGranting(false);
    }
  };

  const filtered = subs.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const profile = s.profiles;
    return (
      profile?.first_name?.toLowerCase().includes(q) ||
      profile?.last_name?.toLowerCase().includes(q) ||
      profile?.email?.toLowerCase().includes(q) ||
      profile?.business_name?.toLowerCase().includes(q) ||
      profile?.business_city?.toLowerCase().includes(q) ||
      s.status.toLowerCase().includes(q)
    );
  });

  // MRR: sum of monthly_amount_cents (derivado del plan en fetchSubs) sobre
  // toda paying sub. Incluye active, past_due y trialing con stripe_sub_id.
  // Excluye admin grants (gratis), canceled/expired/incomplete.
  // cancel_at_period_end SI cuenta — todavía pagan este mes.
  const PAYING_STATUSES = new Set(["active", "past_due", "trialing"]);
  const monthlyRevenueEur = subs.reduce((sum, s) => {
    if (s.granted_by_admin) return sum; // computed: admin grant vigente
    if (!PAYING_STATUSES.has(s.status)) return sum;
    if (!s.stripe_subscription_id) return sum;
    // Fallback: 29.99 € para filas sin plan resuelto.
    const cents = s.monthly_amount_cents ?? 2999;
    return sum + cents / 100;
  }, 0);

  const stats = {
    total: subs.length,
    active: subs.filter((s) => ["active", "trial", "admin_free"].includes(getLogicalStatus(s))).length,
    trial: subs.filter((s) => getLogicalStatus(s) === "trial").length,
    canceled: subs.filter((s) => ["canceled", "expired"].includes(getLogicalStatus(s))).length,
    monthlyRevenue: monthlyRevenueEur,
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Stats — Total / Activos / En prueba / Ingreso mes */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={stats.total} icon={CreditCard} tone="sky" />
        <StatCard label="Activos" value={stats.active} icon={ShieldCheck} tone="emerald" />
        <StatCard label="En prueba" value={stats.trial} icon={Gift} tone="blue" />
        <StatCard
          label="Ingreso mes"
          value={`€${stats.monthlyRevenue.toFixed(2)}`}
          icon={CreditCard}
          tone="violet"
        />
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, email, negocio..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" size="icon" onClick={fetchSubs} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="outline"
          onClick={handleResync}
          disabled={resyncing}
          title="Resincronizar suscripciones desde Stripe (recovery webhook)"
          className="gap-1.5 whitespace-nowrap"
        >
          {resyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Resincronizar</span>
          <span className="sm:hidden">Sync</span>
        </Button>

        {/* Grant access dialog (trigger lives in the bottom bar; this just renders the modal) */}
        <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-sky-500" />
                Conceder acceso gratuito
              </DialogTitle>
              <DialogDescription>
                Otorga acceso Partner sin pagar. Si la duración está vacía, el acceso es ilimitado.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label htmlFor="grant-search" className="text-xs text-muted-foreground">
                  Buscar partner
                </Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="grant-search"
                    placeholder="Email, nombre o negocio..."
                    className="pl-10"
                    value={grantSearch}
                    onChange={(e) => {
                      setGrantSearch(e.target.value);
                      setGrantSelected(null);
                    }}
                  />
                </div>
                {!grantSelected && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                    {grantSearching ? (
                      <div className="flex items-center justify-center p-4 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : grantCandidates.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">Ningún partner encontrado</div>
                    ) : (
                      grantCandidates.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setGrantSelected(c)}
                          className="flex w-full items-center gap-3 border-b border-slate-100 p-2.5 text-left last:border-b-0 hover:bg-sky-50"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={c.profile_image_url || undefined} />
                            <AvatarFallback className="bg-sky-500 text-white text-xs">
                              {(c.business_name || c.email || "P").charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {c.business_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "Partner"}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">{c.email}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {grantSelected && (
                  <div className="mt-2 flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 p-2.5">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={grantSelected.profile_image_url || undefined} />
                      <AvatarFallback className="bg-sky-500 text-white text-xs">
                        {(grantSelected.business_name || grantSelected.email || "P").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {grantSelected.business_name ||
                          [grantSelected.first_name, grantSelected.last_name].filter(Boolean).join(" ") ||
                          "Partner"}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{grantSelected.email}</div>
                    </div>
                    <button
                      onClick={() => setGrantSelected(null)}
                      className="rounded-full p-1 text-slate-500 hover:bg-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="grant-days" className="text-xs text-muted-foreground">
                  Duración (días, vacío = ilimitado)
                </Label>
                <Input
                  id="grant-days"
                  type="number"
                  min={1}
                  max={3650}
                  placeholder="ej. 30"
                  value={grantDays}
                  onChange={(e) => setGrantDays(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="grant-note" className="text-xs text-muted-foreground">
                  Nota interna (opcional)
                </Label>
                <Input
                  id="grant-note"
                  placeholder="ej. Partner VIP del evento X"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetGrantDialog} disabled={granting}>
                Cancelar
              </Button>
              <Button
                onClick={handleGrant}
                disabled={!grantSelected || granting}
                className="bg-sky-500 hover:bg-sky-600"
              >
                {granting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
                Conceder
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center">
          <CreditCard className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-slate-600">
            {subs.length === 0 ? "Aún no hay partners con suscripción." : "Ningún resultado."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((sub) => {
            const profile = sub.profiles;
            const fullName =
              profile?.business_name ||
              [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
              "Partner";
            const initials =
              fullName
                .split(" ")
                .map((p) => p[0]?.toUpperCase())
                .filter(Boolean)
                .slice(0, 2)
                .join("") || "P";
            const logical = getLogicalStatus(sub);
            const meta = STATUS_META[logical];

            // Countdown giorni
            let daysLeft: number | null = null;
            let daysLabel = "";
            const now = new Date();
            if (logical === "trial" && sub.trial_ends_at) {
              daysLeft = differenceInDays(new Date(sub.trial_ends_at), now);
              daysLabel = `Quedan ${Math.max(0, daysLeft)} días de prueba`;
            } else if (logical === "admin_free" && sub.admin_granted_until) {
              daysLeft = differenceInDays(new Date(sub.admin_granted_until), now);
              daysLabel = `Gratis por ${Math.max(0, daysLeft)} días más`;
            } else if (logical === "admin_free" && !sub.admin_granted_until) {
              daysLabel = "Acceso gratuito ilimitado";
            } else if (logical === "active" && sub.current_period_end) {
              daysLeft = differenceInDays(new Date(sub.current_period_end), now);
              daysLabel = `Renueva en ${Math.max(0, daysLeft)} días`;
            }

            const canCancelStripe =
              sub.stripe_subscription_id &&
              ["active", "trialing", "past_due"].includes(sub.status) &&
              !sub.cancel_at_period_end &&
              !sub.admin_granted_until;

            return (
              <div
                key={sub.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <Avatar className="h-14 w-14 flex-shrink-0 ring-2 ring-sky-100">
                    <AvatarImage src={profile?.profile_image_url || undefined} alt={fullName} />
                    <AvatarFallback className="bg-sky-500 font-semibold text-white">{initials}</AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold text-slate-900">{fullName}</h3>
                        {profile?.business_name && profile.first_name && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                            <Building2 className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">
                              {[profile.first_name, profile.last_name].filter(Boolean).join(" ")}
                            </span>
                          </p>
                        )}
                        {profile?.email && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                            <Mail className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{profile.email}</span>
                          </p>
                        )}
                      </div>
                      <Badge className={`${meta.cls} flex-shrink-0 border`} variant="outline">
                        {meta.label}
                      </Badge>
                    </div>

                    {daysLabel && (
                      <div
                        className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                          daysLeft !== null && daysLeft <= 3
                            ? "bg-amber-50 text-amber-700"
                            : "bg-sky-50 text-sky-700"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {daysLabel}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Alta: {format(new Date(sub.created_at), "d MMM yyyy", { locale: es })}
                      </span>
                      {logical === "active" && sub.current_period_end && (
                        <span className="flex items-center gap-1">
                          <RefreshCw className="h-3 w-3" />
                          Renueva: {format(new Date(sub.current_period_end), "d MMM yyyy", { locale: es })}
                        </span>
                      )}
                      {logical === "trial" && sub.trial_ends_at && (
                        <span className="flex items-center gap-1">
                          <Gift className="h-3 w-3" />
                          Fin prueba: {format(new Date(sub.trial_ends_at), "d MMM yyyy", { locale: es })}
                        </span>
                      )}
                      {logical === "admin_free" && sub.admin_granted_until && (
                        <span className="flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Hasta: {format(new Date(sub.admin_granted_until), "d MMM yyyy", { locale: es })}
                        </span>
                      )}
                    </div>

                    {sub.admin_grant_note && (
                      <div className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] italic text-slate-600">
                        Nota: {sub.admin_grant_note}
                      </div>
                    )}

                    {sub.cancel_at_period_end && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                        <Ban className="h-3 w-3" />
                        Se cancela al fin del periodo
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {sub.admin_granted_until && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRevokeTarget(sub)}
                          className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Ban className="mr-1.5 h-3.5 w-3.5" />
                          Revocar acceso
                        </Button>
                      )}
                      {canCancelStripe && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCancelTarget(sub)}
                          className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Ban className="mr-1.5 h-3.5 w-3.5" />
                          Cancelar suscripción
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm cancel Stripe dialog */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar la suscripción?</AlertDialogTitle>
            <AlertDialogDescription>
              La suscripción de{" "}
              <strong>
                {cancelTarget?.profiles?.business_name ||
                  [cancelTarget?.profiles?.first_name, cancelTarget?.profiles?.last_name]
                    .filter(Boolean)
                    .join(" ")}
              </strong>{" "}
              se cancelará al final del periodo de facturación actual. El Partner mantendrá
              el acceso hasta esa fecha.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={canceling}>No cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleCancel();
              }}
              disabled={canceling}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {canceling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelando...
                </>
              ) : (
                "Sí, cancelar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm revoke admin grant dialog */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revocar el acceso gratuito?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>
                {revokeTarget?.profiles?.business_name ||
                  [revokeTarget?.profiles?.first_name, revokeTarget?.profiles?.last_name]
                    .filter(Boolean)
                    .join(" ")}
              </strong>{" "}
              perderá el acceso inmediatamente y deberá suscribirse para volver a usar la plataforma.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleRevoke();
              }}
              disabled={revoking}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {revoking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Revocando...
                </>
              ) : (
                "Sí, revocar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bottom action bar — Conceder acceso + Ver logs */}
      <div
        className="fixed inset-x-0 z-40 border-t border-border/50 bg-background/85 backdrop-blur-xl"
        style={{
          bottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="mx-auto flex max-w-3xl gap-2 px-4 py-2.5">
          <Button
            onClick={() => setGrantOpen(true)}
            className="flex-1 gap-1.5 bg-sky-500 hover:bg-sky-600"
          >
            <Plus className="h-4 w-4" />
            Conceder acceso
          </Button>
          <Button
            variant="outline"
            onClick={() => setLogsOpen(true)}
            className="flex-1 gap-1.5"
          >
            <FileText className="h-4 w-4" />
            Ver logs
          </Button>
        </div>
      </div>

      <WebhookLogsScreen open={logsOpen} onClose={() => setLogsOpen(false)} />
    </div>
  );
};

const StatCard = ({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: any;
  tone: "sky" | "emerald" | "blue" | "violet";
}) => {
  const tones: Record<string, { text: string; bg: string }> = {
    sky: { text: "text-sky-600", bg: "bg-sky-50" },
    emerald: { text: "text-emerald-600", bg: "bg-emerald-50" },
    blue: { text: "text-blue-600", bg: "bg-blue-50" },
    violet: { text: "text-violet-600", bg: "bg-violet-50" },
  };
  const t = tones[tone];

  return (
    <div className={`rounded-2xl border border-white p-4 ${t.bg}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${t.text}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold ${t.text}`}>{value}</div>
    </div>
  );
};

export default SubscriptionsManagement;

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

interface SubRow {
  id: string;
  partner_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  granted_by_admin: boolean;
  admin_granted_until: string | null;
  admin_note: string | null;
  monthly_amount_cents: number | null;
  created_at: string;
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
  if (sub.granted_by_admin) {
    if (!sub.admin_granted_until || new Date(sub.admin_granted_until).getTime() > now) {
      return "admin_free";
    }
    return "expired";
  }
  if (sub.status === "active") return "active";
  if (sub.status === "trialing") {
    if (sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > now) return "trial";
    return "expired";
  }
  if (sub.status === "past_due") return "past_due";
  if (sub.status === "canceled") return "canceled";
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
      // Two-step: avoid relying on PostgREST FK embedding for
      // partner_subscriptions → profiles (the FK targets auth.users, so the
      // embedded join `profiles!partner_subscriptions_partner_id_profiles_fkey`
      // doesn't exist and silently returned []).
      const { data: subRows, error: subErr } = await supabase
        .from("partner_subscriptions")
        .select(
          `id, partner_id, stripe_customer_id, stripe_subscription_id, status,
           current_period_end, trial_ends_at, cancel_at_period_end,
           granted_by_admin, admin_granted_until, admin_note, monthly_amount_cents, created_at`
        )
        .order("created_at", { ascending: false });
      if (subErr) throw subErr;

      const rows = subRows ?? [];
      const partnerIds = [...new Set(rows.map((r) => r.partner_id))];
      let profilesMap = new Map<string, SubRow["profiles"]>();
      if (partnerIds.length > 0) {
        const { data: profs, error: profErr } = await supabase
          .from("profiles")
          .select(
            "id, first_name, last_name, email, business_name, profile_image_url, business_city"
          )
          .in("id", partnerIds);
        if (profErr) throw profErr;
        profilesMap = new Map((profs ?? []).map((p) => [p.id, p as SubRow["profiles"]]));
      }

      setSubs(
        rows.map((r) => ({ ...r, profiles: profilesMap.get(r.partner_id) ?? null })) as SubRow[]
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
      const { error } = await supabase.rpc("admin_revoke_partner_access", {
        _partner_id: revokeTarget.partner_id,
      });
      if (error) throw error;
      toast({ title: "Acceso revocado", description: "El partner ya no podrá acceder a la dashboard." });
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
      }
      const { error } = await supabase.rpc("admin_grant_partner_access", {
        _partner_id: grantSelected.id,
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

  // MRR: sum of monthly_amount_cents over every paying sub.
  // We include "active" and "past_due" (still on the plan, billing retrying)
  // and "trialing" subs that have a Stripe sub attached (will charge at trial end).
  // Excluded: granted_by_admin (free), canceled/expired/incomplete.
  // cancel_at_period_end is INCLUDED — they're still paying *this* month.
  const PAYING_STATUSES = new Set(["active", "past_due", "trialing"]);
  const monthlyRevenueEur = subs.reduce((sum, s) => {
    if (s.granted_by_admin) return sum;
    if (!PAYING_STATUSES.has(s.status)) return sum;
    if (!s.stripe_subscription_id) return sum;
    // Fallback: 29.99 € for legacy rows the webhook hasn't backfilled yet.
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
              !sub.granted_by_admin;

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

                    {sub.admin_note && (
                      <div className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] italic text-slate-600">
                        Nota: {sub.admin_note}
                      </div>
                    )}

                    {sub.cancel_at_period_end && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                        <Ban className="h-3 w-3" />
                        Se cancela al fin del periodo
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {sub.granted_by_admin && (
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

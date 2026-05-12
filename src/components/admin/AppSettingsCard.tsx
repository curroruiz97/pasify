import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Loader2, Gift, ChevronDown } from "lucide-react";

type BoolKey = "require_client_approval" | "require_partner_approval" | "partner_trial_enabled";

const TOGGLES: { key: BoolKey; title: string; description: string }[] = [
  {
    key: "require_client_approval",
    title: "Requerir aprobación de nuevos estudiantes",
    description: "Si está activado, los nuevos registros de estudiantes quedan en estado 'pendiente' hasta que un admin los apruebe manualmente. Si está desactivado, los estudiantes se aprueban automáticamente al registrarse.",
  },
  {
    key: "require_partner_approval",
    title: "Requerir aprobación de nuevos partners",
    description: "Si está activado, los nuevos registros de partners (comercios) quedan en estado 'pendiente'. Normalmente conviene dejarlo desactivado: el partner paga la suscripción y ese es el filtro.",
  },
  {
    key: "partner_trial_enabled",
    title: "Prueba gratuita para nuevos partners",
    description: "Si está activado, los partners al registrarse pueden elegir entre una prueba gratuita de X días o pagar directamente. Si está desactivado, deben pagar inmediatamente para acceder.",
  },
];

const AppSettingsCard = () => {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<BoolKey, boolean>>({
    require_client_approval: false,
    require_partner_approval: false,
    partner_trial_enabled: true,
  });
  const [trialDays, setTrialDays] = useState<number>(15);
  const [trialDaysInput, setTrialDaysInput] = useState<string>("15");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const boolResults = await Promise.all(
          TOGGLES.map((t) => supabase.rpc("get_app_setting_bool", { _key: t.key }))
        );
        const next = { ...values };
        TOGGLES.forEach((t, i) => {
          const { data } = boolResults[i];
          if (typeof data === "boolean") next[t.key] = data;
        });
        setValues(next);

        const { data: days } = await supabase.rpc("get_app_setting_int", { _key: "partner_trial_days" });
        if (typeof days === "number" && days > 0) {
          setTrialDays(days);
          setTrialDaysInput(String(days));
        }
      } catch (err) {
        console.error("Error loading app_settings:", err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async (key: BoolKey, next: boolean) => {
    setSaving(key);
    const prev = values[key];
    setValues((v) => ({ ...v, [key]: next }));
    const { error } = await supabase.rpc("set_app_setting", {
      _key: key,
      _value: next,
    });
    setSaving(null);
    if (error) {
      setValues((v) => ({ ...v, [key]: prev }));
      toast({
        title: "Error al guardar",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    const labels: Record<BoolKey, string> = {
      require_client_approval: "aprobación de estudiantes",
      require_partner_approval: "aprobación de partners",
      partner_trial_enabled: "prueba gratuita partner",
    };
    toast({
      title: "Ajuste guardado",
      description: `${next ? "Activada" : "Desactivada"} ${labels[key]}.`,
    });
  };

  const handleSaveTrialDays = async () => {
    const n = parseInt(trialDaysInput, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 365) {
      toast({
        title: "Valor inválido",
        description: "Introduce un número entre 1 y 365.",
        variant: "destructive",
      });
      return;
    }
    setSaving("partner_trial_days");
    const { error } = await supabase.rpc("set_app_setting", {
      _key: "partner_trial_days",
      _value: n,
    });
    setSaving(null);
    if (error) {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
      return;
    }
    setTrialDays(n);
    toast({ title: "Ajuste guardado", description: `Nuevos partners tendrán ${n} días de prueba.` });
  };

  return (
    <Card className="mb-4 border-blue-100">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full text-left focus:outline-none">
          <CardHeader className="pb-3 transition-colors hover:bg-muted/30">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-5 w-5 text-blue-500" />
                  Ajustes de registro y suscripción
                </CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Controla la aprobación de nuevos usuarios y las condiciones de la prueba gratuita para partners.
                </CardDescription>
              </div>
              <ChevronDown
                className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {loading ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <>
                {TOGGLES.map((t) => (
                  <div key={t.key} className="flex items-start justify-between gap-4 rounded-lg border border-border/50 bg-muted/30 p-3">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={t.key} className="text-sm font-medium">
                        {t.title}
                      </Label>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      {saving === t.key && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Switch
                        id={t.key}
                        checked={values[t.key]}
                        onCheckedChange={(checked) => handleToggle(t.key, checked)}
                        disabled={saving === t.key}
                      />
                    </div>
                  </div>
                ))}

                {values.partner_trial_enabled && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Gift className="h-4 w-4 text-emerald-600" />
                      <Label htmlFor="partner_trial_days" className="text-sm font-medium">
                        Días de prueba para partners
                      </Label>
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Duración de la prueba gratuita para partners recién registrados (actualmente: <strong>{trialDays} días</strong>).
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        id="partner_trial_days"
                        type="number"
                        min={1}
                        max={365}
                        className="h-9 w-24"
                        value={trialDaysInput}
                        onChange={(e) => setTrialDaysInput(e.target.value)}
                        disabled={saving === "partner_trial_days"}
                      />
                      <span className="text-sm text-muted-foreground">días</span>
                      <Button
                        size="sm"
                        onClick={handleSaveTrialDays}
                        disabled={saving === "partner_trial_days" || trialDaysInput === String(trialDays)}
                        className="ml-auto"
                      >
                        {saving === "partner_trial_days" && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        Guardar
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default AppSettingsCard;

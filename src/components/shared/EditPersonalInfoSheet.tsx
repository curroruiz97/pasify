import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Globe2, Loader2, MapPin } from "lucide-react";
import { SpanishCitySelect } from "@/components/ui/spanish-city-select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { TODA_ESPANA, type MyProfile } from "@/hooks/queries/clientData";
import { withTimeout, TimeoutError } from "@/lib/withTimeout";
import { qk } from "@/lib/cache/keys";

const NETWORK_TIMEOUT_MS = 8000;

interface EditPersonalInfoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras guardar con éxito, por si el padre quiere refrescar displayName. */
  onSaved?: (data: { firstName: string; lastName: string; phone: string }) => void;
  /**
   * Enseña la ciudad (la que filtra Inicio y el Calendario). Por defecto, solo
   * a los clientes: en un local, profiles.city es la ciudad pública de su ficha
   * y se cambia desde los ajustes del local.
   */
  showCity?: boolean;
}

/**
 * Formulario real de "Editar perfil" (nombre, apellidos, teléfono).
 *
 * FIX Apple Review — Guideline 2.1(a) (submission 14204a0e-90da-43d1-b420-2a76956de94d):
 * el botón "Editar perfil" de SettingsSheet no tenía `onClick`: al tocarlo
 * no pasaba absolutamente nada, lo cual el reviewer interpretó (con razón)
 * como que la app "no responde a los toques / se queda congelada". Este
 * componente es la pantalla real que faltaba, con:
 *  - carga y guardado con timeout explícito (nunca puede colgarse para
 *    siempre — ver withTimeout / capacitorStorage.ts),
 *  - try/catch/finally correcto para que el botón de guardar SIEMPRE se
 *    vuelva a habilitar, haya éxito, error o timeout,
 *  - mensajes de error visibles en vez de fallar en silencio.
 *
 * Al guardar actualiza el perfil de la caché (qk.me.profile): la hoja de
 * perfil del cliente, la cabecera y los filtros de ciudad de Inicio y del
 * Calendario cambian sin recargar.
 *
 * Ciudad (B2-10), solo para clientes: SpanishCitySelect o «Toda España»
 * (profiles.city vacía). Con Google o Apple la cuenta nace sin ciudad y antes
 * no había dónde ponerla.
 */
const EditPersonalInfoSheet = ({ open, onOpenChange, onSaved, showCity }: EditPersonalInfoSheetProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveRole } = useAuth();
  const conCiudad = showCity ?? effectiveRole === "client";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  // "espana" = Toda España (sin ciudad); "ciudad" = la de SpanishCitySelect.
  const [modoCiudad, setModoCiudad] = useState<"espana" | "ciudad">("espana");
  const [city, setCity] = useState("");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const {
          data: { user },
        } = await withTimeout(supabase.auth.getUser(), NETWORK_TIMEOUT_MS, "auth.getUser");

        if (!user) {
          if (!cancelled) {
            setLoadError("No se pudo verificar tu sesión. Cierra y vuelve a abrir la app.");
          }
          return;
        }

        const { data, error } = await withTimeout(
          supabase.from("profiles").select("first_name, last_name, phone, city").eq("id", user.id).maybeSingle(),
          NETWORK_TIMEOUT_MS,
          "profiles.select"
        );

        if (error) throw error;
        if (cancelled) return;

        setFirstName(data?.first_name ?? "");
        setLastName(data?.last_name ?? "");
        setPhone(data?.phone ?? "");
        const ciudad = data?.city?.trim() ?? "";
        setCity(ciudad);
        setModoCiudad(ciudad ? "ciudad" : "espana");
      } catch (err: any) {
        console.error("[EditPersonalInfoSheet] load error:", err);
        if (!cancelled) {
          setLoadError(
            err instanceof TimeoutError
              ? "La carga está tardando demasiado. Comprueba tu conexión e inténtalo de nuevo."
              : err?.message ?? "No se pudo cargar tu perfil."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSave = async () => {
    // «Una ciudad» sin elegir ninguna: mejor avisar que guardar «Toda España» sin querer.
    if (conCiudad && modoCiudad === "ciudad" && !city.trim()) {
      toast({
        title: "Elige tu ciudad",
        description: `Busca tu ciudad o marca «${TODA_ESPANA}».`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const {
        data: { user },
      } = await withTimeout(supabase.auth.getUser(), NETWORK_TIMEOUT_MS, "auth.getUser");

      if (!user) {
        toast({
          title: "Error",
          description: "No se pudo verificar tu sesión. Cierra y vuelve a abrir la app.",
          variant: "destructive",
        });
        return;
      }

      const nombre = firstName.trim() || null;
      const apellidos = lastName.trim() || null;
      // Solo si se ha enseñado (undefined = no se toca): en un local es la
      // ciudad pública de su ficha.
      const ciudad = conCiudad ? (modoCiudad === "ciudad" ? city.trim() || null : null) : undefined;
      const { error } = await withTimeout(
        supabase
          .from("profiles")
          .update({
            first_name: nombre,
            last_name: apellidos,
            phone: phone.trim() || null,
            ...(ciudad !== undefined ? { city: ciudad } : {}),
          })
          .eq("id", user.id),
        NETWORK_TIMEOUT_MS,
        "profiles.update"
      );

      if (error) throw error;

      // Al momento en la cabecera, la hoja de perfil y los filtros de ciudad;
      // el refresco confirma lo guardado.
      queryClient.setQueryData<MyProfile | null>(qk.me.profile(user.id), (prev) =>
        prev
          ? {
              ...prev,
              first_name: nombre,
              last_name: apellidos,
              ...(ciudad !== undefined ? { city: ciudad } : {}),
            }
          : prev
      );
      void queryClient.invalidateQueries({ queryKey: qk.me.profile(user.id) });

      toast({
        title: "Perfil actualizado",
        description: "Tus datos se han guardado correctamente.",
      });

      onSaved?.({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() });
      onOpenChange(false);
    } catch (err: any) {
      console.error("[EditPersonalInfoSheet] save error:", err);
      toast({
        title: "Error al guardar",
        description:
          err instanceof TimeoutError
            ? "La operación está tardando demasiado. Comprueba tu conexión e inténtalo de nuevo."
            : err?.message ?? "No se pudo guardar tu perfil.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[92vw] max-w-md flex-col gap-0 p-0">
        <SheetHeader
          className="border-b px-4 py-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <SheetTitle>Editar perfil</SheetTitle>
          <SheetDescription className="sr-only">
            {conCiudad ? "Edita tu nombre, apellidos, teléfono y ciudad." : "Edita tu nombre, apellidos y teléfono."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Cargando tu perfil…
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
              <p>{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="edit-first-name">Nombre</Label>
                <Input
                  id="edit-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Nombre"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-last-name">Apellidos</Label>
                <Input
                  id="edit-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Apellidos"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Teléfono</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Teléfono"
                />
              </div>
              {conCiudad && (
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium leading-none">Tu ciudad</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <OpcionCiudad
                      activa={modoCiudad === "espana"}
                      onClick={() => setModoCiudad("espana")}
                      icono={<Globe2 className="h-4 w-4" />}
                      texto={TODA_ESPANA}
                    />
                    <OpcionCiudad
                      activa={modoCiudad === "ciudad"}
                      onClick={() => setModoCiudad("ciudad")}
                      icono={<MapPin className="h-4 w-4" />}
                      texto="Una ciudad"
                    />
                  </div>
                  {modoCiudad === "ciudad" && (
                    <SpanishCitySelect
                      id="edit-city"
                      value={city}
                      onValueChange={setCity}
                      placeholder="Busca tu ciudad"
                    />
                  )}
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Inicio y el Calendario te enseñan los locales y eventos de tu ciudad
                    {modoCiudad === "espana" ? ": ahora, los de toda España." : "."}
                  </p>
                </fieldset>
              )}
            </div>
          )}
        </div>

        {!loading && !loadError && (
          <div
            className="flex gap-2 border-t p-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          >
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

/** Botón de «Toda España» / «Una ciudad» (44 px de alto como mínimo). */
const OpcionCiudad = ({
  activa,
  onClick,
  icono,
  texto,
}: {
  activa: boolean;
  onClick: () => void;
  icono: React.ReactNode;
  texto: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={activa}
    className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${
      activa
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
    }`}
  >
    {icono}
    {texto}
  </button>
);

export default EditPersonalInfoSheet;

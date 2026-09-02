import { useEffect, useState } from "react";
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
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { withTimeout, TimeoutError } from "@/lib/withTimeout";

const NETWORK_TIMEOUT_MS = 8000;

interface EditPersonalInfoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras guardar con éxito, por si el padre quiere refrescar displayName. */
  onSaved?: (data: { firstName: string; lastName: string; phone: string }) => void;
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
 */
const EditPersonalInfoSheet = ({ open, onOpenChange, onSaved }: EditPersonalInfoSheetProps) => {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

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
          supabase.from("profiles").select("first_name, last_name, phone").eq("id", user.id).maybeSingle(),
          NETWORK_TIMEOUT_MS,
          "profiles.select"
        );

        if (error) throw error;
        if (cancelled) return;

        setFirstName(data?.first_name ?? "");
        setLastName(data?.last_name ?? "");
        setPhone(data?.phone ?? "");
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

      const { error } = await withTimeout(
        supabase
          .from("profiles")
          .update({
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            phone: phone.trim() || null,
          })
          .eq("id", user.id),
        NETWORK_TIMEOUT_MS,
        "profiles.update"
      );

      if (error) throw error;

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
          <SheetDescription className="sr-only">Edita tu nombre, apellidos y teléfono.</SheetDescription>
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

export default EditPersonalInfoSheet;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import EditPersonalInfoSheet from "@/components/shared/EditPersonalInfoSheet";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  Coins,
  Download,
  FileText,
  KeyRound,
  LifeBuoy,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  UserCircle,
} from "lucide-react";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/** Correo real de soporte. Es el mismo que publica /soporte, la URL que
 *  Apple abre desde la ficha de App Store. */
const SUPPORT_EMAIL = "comunicacion@avenuemedia.io";

const MIN_PASSWORD_LENGTH = 8;

// Inyectado por vite.config.ts (`pasify@<sha12>`). Solo se enseña en web.
declare const __PASIFY_RELEASE__: string;
const WEB_BUILD =
  typeof __PASIFY_RELEASE__ !== "undefined" && !__PASIFY_RELEASE__.endsWith("@dev")
    ? __PASIFY_RELEASE__.replace(/^pasify@/, "")
    : null;

export type SettingsRole = "client" | "partner" | "admin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: SettingsRole;
  /** Email del usuario para mostrar en la tarjeta de cuenta. Si no llega, se lee de la sesión. */
  email?: string | null;
  /** Nombre legible (Cliente: nombre · Partner: business_name · Admin: "Admin") */
  displayName?: string | null;
  /** Slot opcional para inyectar contenido con persistencia real (e.g.
   *  el bloque de Organización + Local del partner). Va arriba del
   *  body, después de la account hero card. */
  partnerSlot?: React.ReactNode;
}

type LoadState = "loading" | "ready" | "error";

const passwordErrorMessage = (code: string | undefined) => {
  switch (code) {
    case "same_password":
      return "La nueva contraseña tiene que ser distinta de la actual.";
    case "weak_password":
      return "Esa contraseña es demasiado débil. Prueba con una más larga o que mezcle letras, números y símbolos.";
    case "reauthentication_needed":
    case "reauth_nonce_missing":
      return "Por seguridad, cámbiala desde «¿Olvidaste tu contraseña?» en la pantalla de inicio de sesión.";
    case "session_not_found":
    case "session_expired":
      return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
    default:
      return "No hemos podido cambiar la contraseña. Vuelve a intentarlo.";
  }
};

/* ============================================================
   SettingsSheet — ajustes de cuenta, role-aware.
   Solo lleva controles que hacen algo de verdad. Este panel estaba
   lleno de filas de maqueta (teléfono inventado, 2FA y sesiones
   fingidas, Stripe "conectado", interruptores que no guardaban nada y
   un "Guardar cambios" que solo lanzaba un toast): el mismo patrón de
   la directriz 2.1(a) por la que Apple rechazó la 1.0.
   ============================================================ */

export const SettingsSheet = ({
  open,
  onOpenChange,
  role,
  email,
  displayName,
  partnerSlot,
}: Props) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [sessionUser, setSessionUser] = useState<{ id: string; email: string | null } | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [salesEmail, setSalesEmail] = useState(true);
  const [salesEmailState, setSalesEmailState] = useState<LoadState>("loading");
  const [salesEmailReload, setSalesEmailReload] = useState(0);
  const [savingSalesEmail, setSavingSalesEmail] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);

  const [appVersion, setAppVersion] = useState<string | null>(
    Capacitor.isNativePlatform() ? null : WEB_BUILD ? `Web · ${WEB_BUILD}` : null
  );

  const accountEmail = email ?? sessionUser?.email ?? null;
  const userId = sessionUser?.id ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const user = data.session?.user;
      setSessionUser(user ? { id: user.id, email: user.email ?? null } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    CapacitorApp.getInfo()
      .then((info) => {
        if (!cancelled) setAppVersion(`${info.version} (${info.build})`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /* Aviso por email de cada venta. dispatch-notification (stripe-webhook ->
     notificación "Venta: <evento>", categoría tickets) lee esta fila antes de
     mandar el correo; sin fila, el envío está activo. */
  useEffect(() => {
    if (!open || role !== "partner" || !userId) return;
    let cancelled = false;
    setSalesEmailState("loading");
    (async () => {
      const { data, error } = await supabase
        .from("user_notification_prefs")
        .select("enabled")
        .eq("user_id", userId)
        .eq("channel", "email")
        .eq("category", "tickets")
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("user_notification_prefs:", error);
        setSalesEmailState("error");
        return;
      }
      setSalesEmail(data ? data.enabled : true);
      setSalesEmailState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, role, userId, salesEmailReload]);

  const handleSalesEmailChange = async (next: boolean) => {
    if (!userId || savingSalesEmail) return;
    const previous = salesEmail;
    setSalesEmail(next);
    setSavingSalesEmail(true);
    const { error } = await supabase
      .from("user_notification_prefs")
      .upsert(
        { user_id: userId, channel: "email", category: "tickets", enabled: next },
        { onConflict: "user_id,channel,category" }
      );
    setSavingSalesEmail(false);
    if (error) {
      console.error("user_notification_prefs upsert:", error);
      setSalesEmail(previous);
      toast({
        title: "No se ha guardado el cambio",
        description: "Revisa tu conexión y vuelve a intentarlo.",
        variant: "destructive",
      });
    }
  };

  const resetPasswordForm = () => {
    setPasswordOpen(false);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError(null);
  };

  const handlePasswordChange = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Las contraseñas no coinciden.");
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordError(passwordErrorMessage(error.code));
        return;
      }
      resetPasswordForm();
      toast({ title: "Contraseña actualizada", description: "La próxima vez entra con la nueva." });
    } catch (err) {
      console.error("updateUser(password):", err);
      setPasswordError(passwordErrorMessage(undefined));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSignOutOthers = async () => {
    setSigningOutOthers(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast({
        title: "Sesiones cerradas",
        description: "Hemos cerrado tu sesión en el resto de dispositivos. En este sigues conectado.",
      });
    } catch (err) {
      console.error("signOut(others):", err);
      toast({
        title: "No hemos podido cerrar las otras sesiones",
        description: "Revisa tu conexión y vuelve a intentarlo.",
        variant: "destructive",
      });
    } finally {
      setSigningOutOthers(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      onOpenChange(false);
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("signOut(local):", err);
      toast({
        title: "No hemos podido cerrar la sesión",
        description: "Vuelve a intentarlo.",
        variant: "destructive",
      });
    } finally {
      setSigningOut(false);
    }
  };

  const goTo = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  /* ------------------------------------------------------------------
     Borrado de cuenta — guia 5.1.1(v) de Apple.
     OJO: hasta la build 4 esta fila solo lanzaba un toast ("Te enviaremos
     un email para confirmar") y no llamaba a nada. La edge function
     delete-own-account ya existia y funcionaba, pero solo la invocaban
     partner/SettingsSheet.tsx y client/ClientSettingsSheet.tsx, que
     quedaron sin ruta al retirar del router las pantallas social/perfil.
     Este es el unico panel de ajustes accesible en la app, asi que el
     borrado real tiene que salir de aqui.
     Si el local tiene eventos futuros con entradas vendidas, la funcion
     responde 409 partner_has_upcoming_sales y se enseña su mensaje.
     ------------------------------------------------------------------ */
  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-own-account");
      if (error) {
        let serverMessage: string | null = null;
        if (error instanceof FunctionsHttpError) {
          const response = error.context as Response;
          const body = (await response.json().catch(() => null)) as
            | { error?: string; message?: string }
            | null;
          if (response.status === 409 && body?.error === "partner_has_upcoming_sales") {
            setDeleteBlocked(
              body.message ||
                `Tu local tiene eventos próximos con entradas vendidas, así que todavía no se puede eliminar la cuenta. Escríbenos a ${SUPPORT_EMAIL} y lo resolvemos contigo.`
            );
            return;
          }
          serverMessage = body?.message ?? null;
        }
        console.error("delete-own-account:", error);
        toast({
          title: "No hemos podido eliminar la cuenta",
          description: serverMessage ?? `Vuelve a intentarlo o escríbenos a ${SUPPORT_EMAIL}.`,
          variant: "destructive",
        });
        return;
      }

      // La cuenta ya no existe: el token local es basura. Limpiamos sesion
      // y mandamos al login, si no la app se queda con una sesion fantasma.
      await supabase.auth.signOut({ scope: "local" });
      setShowDeleteConfirm(false);
      onOpenChange(false);
      toast({
        title: "Cuenta eliminada",
        description: "Tu cuenta y tus datos se han borrado. Hasta pronto.",
      });
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("delete-own-account:", err);
      toast({
        title: "No hemos podido eliminar la cuenta",
        description: `Vuelve a intentarlo o escríbenos a ${SUPPORT_EMAIL}.`,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setDeleteBlocked(null);
  };

  /* Peticion de acceso a datos (art. 15 RGPD). No prometemos un ZIP
     automatico que no existe: abrimos el correo de soporte con la
     solicitud ya redactada y la atiende una persona. */
  const handleRequestData = () => {
    const asunto = "Solicitud de acceso a mis datos (RGPD)";
    const cuerpo = [
      "Hola,",
      "",
      "Solicito una copia de los datos personales que Pasify tiene sobre mi cuenta,",
      "conforme al artículo 15 del RGPD.",
      "",
      `Correo de la cuenta: ${accountEmail ?? ""}`,
      "",
      "Gracias.",
    ].join("\n");
    window.location.href =
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(asunto)}` +
      `&body=${encodeURIComponent(cuerpo)}`;
    toast({
      title: "Abriendo tu correo",
      description: `Envíanos la solicitud a ${SUPPORT_EMAIL} y te respondemos en 30 días como máximo.`,
    });
  };

  const roleLabel =
    role === "client" ? "Cliente" : role === "partner" ? "Local" : "Admin";

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[92vw] max-w-md flex-col gap-0 border-l border-border bg-background p-0"
      >
        {/* ============ HEADER ============ */}
        <header
          className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div
              className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <span className="inline-block h-px w-4 bg-orange-500/70" />
              Pasify · Ajustes · {roleLabel}
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Configuración
            </h2>
          </div>
        </header>

        {/* ============ BODY ============ */}
        <div className="flex-1 overflow-y-auto p-4 pb-6">
          <div className="space-y-4">
            {/* === Account hero card === */}
            <section
              className="relative overflow-hidden rounded-2xl border p-4"
              style={{
                background:
                  "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.02) 100%)",
                borderColor: "rgba(232,84,42,0.32)",
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full"
                style={{ background: "rgba(232,84,42,0.22)", filter: "blur(60px)" }}
              />
              <div className="relative flex items-center gap-3">
                <div
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
                  style={{
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.3), 0 8px 22px -8px rgba(232,84,42,0.6)",
                  }}
                >
                  <UserCircle className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                    {displayName || "Tu cuenta"}
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px] text-muted-foreground"
                    style={mono}
                  >
                    {accountEmail ?? "—"}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="relative mt-3 w-full"
                onClick={() => setEditProfileOpen(true)}
              >
                <UserCircle className="mr-1.5 h-3.5 w-3.5" />
                Editar perfil
              </Button>
            </section>

            {/* === Partner real persistence slot === */}
            {role === "partner" && partnerSlot}

            {/* === Seguridad === */}
            <SectionCard
              eyebrow="Seguridad"
              icon={<ShieldCheck className="h-3 w-3" />}
              title="Cómo proteges tu cuenta"
            >
              <Row
                icon={<KeyRound className="h-4 w-4" />}
                label="Cambiar contraseña"
                onPress={() => (passwordOpen ? resetPasswordForm() : setPasswordOpen(true))}
                expanded={passwordOpen}
              />
              {passwordOpen && (
                <form
                  className="mx-3 mb-2 mt-1 space-y-2 rounded-xl border border-border p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handlePasswordChange();
                  }}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Nueva contraseña"
                    aria-label="Nueva contraseña"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={savingPassword}
                  />
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repite la nueva contraseña"
                    aria-label="Repite la nueva contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={savingPassword}
                  />
                  <p
                    className={`text-[11.5px] leading-relaxed ${passwordError ? "text-red-500" : "text-muted-foreground"}`}
                    role={passwordError ? "alert" : undefined}
                  >
                    {passwordError ?? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={savingPassword}
                      onClick={resetPasswordForm}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="flex-1"
                      disabled={savingPassword || !newPassword || !confirmPassword}
                    >
                      {savingPassword ? "Guardando…" : "Guardar contraseña"}
                    </Button>
                  </div>
                </form>
              )}
              <Divider />
              <Row
                icon={<MonitorSmartphone className="h-4 w-4" />}
                label="Cerrar sesión en otros dispositivos"
                description="Este dispositivo sigue conectado."
                onPress={handleSignOutOthers}
                busy={signingOutOthers}
              />
            </SectionCard>

            {/* === Cobros y avisos (local) === */}
            {role === "partner" && (
              <SectionCard
                eyebrow="Tu local"
                icon={<Store className="h-3 w-3" />}
                title="Cobros y avisos"
              >
                <Row
                  icon={<Coins className="h-4 w-4" />}
                  label="Cobros"
                  description="Pasify cobra las entradas por ti y te liquida lo vendido. Sin cuotas: solo se aplica una comisión por entrada vendida."
                />
                <Divider />
                <div className="flex items-start gap-3 rounded-xl px-3 py-2.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Mail className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground">Email por cada venta</div>
                    <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      {salesEmailState === "error"
                        ? "No hemos podido cargar esta preferencia."
                        : "Te escribimos cuando alguien compra entradas para tus eventos."}
                    </div>
                  </div>
                  {salesEmailState === "loading" ? (
                    <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
                  ) : salesEmailState === "error" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-[11px]"
                      onClick={() => setSalesEmailReload((n) => n + 1)}
                    >
                      Reintentar
                    </Button>
                  ) : (
                    <Switch
                      checked={salesEmail}
                      onCheckedChange={handleSalesEmailChange}
                      disabled={savingSalesEmail}
                      aria-label="Email por cada venta"
                    />
                  )}
                </div>
              </SectionCard>
            )}

            {/* === Privacidad === */}
            <SectionCard
              eyebrow="Privacidad & datos"
              icon={<Lock className="h-3 w-3" />}
              title="Tu información, tus reglas"
            >
              <Row
                icon={<Download className="h-4 w-4" />}
                label="Descargar mis datos"
                value="RGPD"
                onPress={handleRequestData}
              />
              <Divider />
              <Row
                icon={<FileText className="h-4 w-4" />}
                label="Política de privacidad"
                onPress={() => goTo("/privacidad")}
              />
              <Divider />
              <DangerRow
                icon={<Trash2 className="h-4 w-4" />}
                label="Eliminar mi cuenta"
                description={
                  role === "partner"
                    ? "Permanente: se borra tu cuenta y dejas de tener acceso al panel del local."
                    : "Permanente: se borran tu cuenta y tus datos personales."
                }
                onPress={() => {
                  setDeleteBlocked(null);
                  setShowDeleteConfirm(true);
                }}
              />
              {showDeleteConfirm && (
                <div
                  className="mt-2 rounded-xl border p-3"
                  style={{
                    background: "rgba(239,68,68,0.06)",
                    borderColor: "rgba(239,68,68,0.4)",
                  }}
                >
                  {deleteBlocked ? (
                    <>
                      <div className="flex items-start gap-2" role="alert">
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <div className="text-[12px] leading-relaxed text-foreground">{deleteBlocked}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={closeDeleteConfirm}
                      >
                        Entendido
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <div className="text-[12px] leading-relaxed text-foreground">
                          Esta acción es <strong>irreversible</strong>. Si confirmas, se
                          eliminará ahora mismo tu cuenta y se cerrará la sesión.
                          {role === "partner" &&
                            " Si tu local tiene eventos próximos con entradas vendidas, todavía no se podrá eliminar."}
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          disabled={deleting}
                          onClick={closeDeleteConfirm}
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          style={{ background: "#EF4444", border: 0, color: "#fff" }}
                          disabled={deleting}
                          onClick={handleDeleteAccount}
                        >
                          {deleting ? "Eliminando…" : "Confirmar"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </SectionCard>

            {/* === Acerca de === */}
            <SectionCard
              eyebrow="Acerca de"
              icon={<Sparkles className="h-3 w-3" />}
              title="Pasify"
            >
              <Row
                icon={<LifeBuoy className="h-4 w-4" />}
                label="Soporte"
                onPress={() => goTo("/soporte")}
              />
              {appVersion && (
                <>
                  <Divider />
                  <Row
                    icon={<Sparkles className="h-4 w-4" />}
                    label="Versión"
                    value={appVersion}
                  />
                </>
              )}
            </SectionCard>
          </div>
        </div>

        {/* ============ STICKY FOOTER ============ */}
        <footer
          className="sticky bottom-0 z-10 border-t border-border bg-card/90 p-3 backdrop-blur-xl"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={signingOut}
            className="h-11 w-full text-[14px] font-semibold"
          >
            {signingOut ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            Cerrar sesión
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
    <EditPersonalInfoSheet open={editProfileOpen} onOpenChange={setEditProfileOpen} />
    </>
  );
};

/* ============================================================
   PRIMITIVES — reutilizables dentro del Sheet
   ============================================================ */

const SectionCard = ({
  eyebrow,
  icon,
  title,
  children,
}: {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) => (
  <section
    className="rounded-2xl border border-border bg-card"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
  >
    <div className="border-b border-border/60 p-4">
      <div
        className="inline-flex items-center gap-2 text-[9.5px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        {icon}
        {eyebrow}
      </div>
      <h3 className="mt-0.5 text-[14.5px] font-semibold tracking-tight text-foreground">
        {title}
      </h3>
    </div>
    <div className="p-1">{children}</div>
  </section>
);

/** Fila de ajustes. Sin `onPress` es solo informativa (no se pinta como botón). */
const Row = ({
  icon,
  label,
  value,
  description,
  onPress,
  busy,
  expanded,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  description?: string;
  onPress?: () => void;
  busy?: boolean;
  expanded?: boolean;
}) => {
  const content = (
    <>
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {value && (
        <span
          className="mt-1.5 max-w-[45%] truncate text-right text-[11.5px] text-muted-foreground"
          style={mono}
        >
          {value}
        </span>
      )}
    </>
  );

  if (!onPress) {
    return <div className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={busy}
      aria-expanded={expanded}
      className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-muted disabled:cursor-wait disabled:opacity-70"
    >
      {content}
      {busy ? (
        <Loader2 className="mt-1.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <ChevronRight
          className={`mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/70 transition group-hover:text-foreground ${expanded ? "rotate-90" : ""}`}
        />
      )}
    </button>
  );
};

const DangerRow = ({
  icon,
  label,
  description,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onPress: () => void;
}) => (
  <button
    type="button"
    onClick={onPress}
    className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-red-500/5"
  >
    <span
      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
      style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444" }}
    >
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <span className="text-[13px] font-medium text-red-500">{label}</span>
      {description && (
        <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}
    </div>
    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-red-500/70" />
  </button>
);

const Divider = () => (
  <div className="mx-3 h-px" style={{ background: "rgba(244,238,226,0.06)" }} />
);

export default SettingsSheet;

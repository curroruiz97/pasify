import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Globe, Lock, LogOut, Trash2, Loader2, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
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

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

interface ClientSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ClientSettingsSheet = ({ open, onOpenChange }: ClientSettingsSheetProps) => {
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [language, setLanguage] = useState(i18n.language);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setLanguage(i18n.language);
  }, [i18n.language]);

  const handleLanguageChange = async (newLang: string) => {
    try {
      setLanguage(newLang);
      await i18n.changeLanguage(newLang);
      localStorage.setItem("appLanguage", newLang);
      toast({ title: t("common.success"), description: t("success.profileUpdated") });
    } catch (error) {
      console.error("Failed to change language:", error);
      toast({ title: t("common.error"), description: "Errore nel cambio lingua", variant: "destructive" });
    }
  };

  const handlePasswordChange = async () => {
    if (!newPassword || !confirmPassword) {
      toast({ title: t("common.error"), description: t("errors.fillAllFields"), variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t("common.error"), description: t("errors.passwordMismatch"), variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: t("common.error"), description: t("errors.passwordTooShort"), variant: "destructive" });
      return;
    }
    setIsChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsChangingPassword(false);
    if (error) {
      toast({ title: t("common.error"), description: t("errors.changePasswordFailed"), variant: "destructive" });
      return;
    }
    toast({ title: t("common.success"), description: t("success.passwordChanged") });
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: t("auth.logout"), description: t("success.loggedOut") });
    navigate("/login");
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: t("common.error"), description: "No active session", variant: "destructive" });
        return;
      }
      const { error } = await supabase.functions.invoke("delete-own-account", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        console.error("Delete account error:", error);
        toast({ title: t("common.error"), description: "Error al eliminar la cuenta", variant: "destructive" });
        return;
      }
      toast({ title: t("common.success"), description: "Cuenta eliminada correctamente" });
      await supabase.auth.signOut();
      navigate("/login");
    } catch (error) {
      console.error("Delete account error:", error);
      toast({ title: t("common.error"), description: "Error al eliminar la cuenta", variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          className="border-t-0 bg-gradient-to-b from-sky-50/40 via-white to-white"
          style={{ fontFamily: "'Inter', system-ui, sans-serif", maxHeight: "88vh" }}
        >
          <DrawerHeader className="px-5 pb-2 pt-4 text-center">
            <DrawerTitle className="text-2xl font-bold tracking-tight text-slate-900">
              Ajustes de cuenta
            </DrawerTitle>
          </DrawerHeader>

          <div
            className="space-y-4 overflow-y-auto px-5 pt-2"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))" }}
          >
            {/* Idioma */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                  <Globe className="h-4 w-4" />
                </div>
                <Label htmlFor="language" className="text-sm font-semibold text-slate-900">
                  {t("settings.language")}
                </Label>
              </div>
              <Select value={language} onValueChange={handleLanguageChange}>
                <SelectTrigger id="language" className="h-10 rounded-xl border-slate-200 bg-slate-50">
                  <SelectValue placeholder={t("settings.selectLanguage")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="it">🇮🇹 Italiano</SelectItem>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                  <SelectItem value="es">🇪🇸 Español</SelectItem>
                  <SelectItem value="fr">🇫🇷 Français</SelectItem>
                  <SelectItem value="de">🇩🇪 Deutsch</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Cambiar contraseña */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                  <Lock className="h-4 w-4" />
                </div>
                <Label className="text-sm font-semibold text-slate-900">
                  {t("settings.changePassword")}
                </Label>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className="text-xs text-slate-600">
                    {t("settings.newPassword")}
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-10 rounded-xl border-slate-200 bg-slate-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-xs text-slate-600">
                    {t("settings.confirmPassword")}
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-10 rounded-xl border-slate-200 bg-slate-50"
                  />
                </div>

                <Button
                  onClick={handlePasswordChange}
                  disabled={isChangingPassword || !newPassword || !confirmPassword}
                  className="h-10 w-full rounded-xl text-sm font-semibold text-white"
                  style={{
                    background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                    boxShadow: "0 8px 20px -6px rgba(14,165,233,0.4)",
                  }}
                >
                  {isChangingPassword ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("settings.saving")}
                    </>
                  ) : (
                    t("settings.changePasswordButton")
                  )}
                </Button>
              </div>
            </div>

            {/* Zona peligrosa */}
            <div className="rounded-2xl border border-rose-200/70 bg-gradient-to-b from-rose-50/50 to-white p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-rose-600">
                Zona peligrosa
              </div>
              <div className="space-y-2.5">
                <Button
                  onClick={() => setShowLogoutDialog(true)}
                  variant="outline"
                  className="h-11 w-full justify-start gap-3 rounded-xl border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <LogOut className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-sm font-medium">{t("auth.logout")}</span>
                  <ChevronRight className="ml-auto h-4 w-4 text-slate-300" />
                </Button>

                <Button
                  onClick={() => setShowDeleteDialog(true)}
                  variant="outline"
                  className="h-11 w-full justify-start gap-3 rounded-xl border-rose-200 bg-white text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-sm font-medium">Eliminar cuenta</span>
                  <ChevronRight className="ml-auto h-4 w-4 text-rose-300" />
                </Button>
              </div>
            </div>

            <p className="pb-2 pt-1 text-center text-[11px] text-slate-400">
              Pasify · v1.0
            </p>
          </div>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar sesión?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu sesión actual se cerrará. Podrás volver a acceder con tu email y contraseña.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>{t("auth.logout")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminarán permanentemente tu cuenta y todos tus datos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={isDeleting}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Eliminando...
                </>
              ) : (
                "Confirmar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ClientSettingsSheet;

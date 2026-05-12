import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Camera, LogOut, Settings, ChevronRight, Loader2, MapPin } from "lucide-react";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  city: string | null;
  avatar_url: string | null;
  created_at: string;
};

interface Props {
  userId: string;
  /** "avatar" = solo cerchio (default top-bar). "row" = riga avatar+nome (sidebar). */
  variant?: "avatar" | "row";
}

/**
 * Avatar trigger in alto-dx + Sheet laterale per profilo cliente.
 * Modifica foto (storage `avatars`), vede nome/cognome/anzianità, settings, logout.
 */
export const ProfileSheet = ({ userId, variant = "avatar" }: Props) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email, city, avatar_url, created_at")
        .eq("id", userId)
        .maybeSingle();
      if (data) setProfile(data as Profile);
    })();
  }, [userId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Imagen muy grande", description: "Máximo 5 MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const newUrl = pub.publicUrl;

      const { error: profErr } = await supabase
        .from("profiles")
        .update({ avatar_url: newUrl })
        .eq("id", userId);
      if (profErr) throw profErr;

      setProfile((prev) => (prev ? { ...prev, avatar_url: newUrl } : prev));
      toast({ title: "Foto actualizada" });
    } catch (err: any) {
      console.error("upload avatar:", err);
      toast({ title: "Error", description: err?.message ?? "No se pudo subir la foto.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const initial = (profile?.first_name?.[0] ?? profile?.email?.[0] ?? "?").toUpperCase();
  const fullName =
    `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || profile?.email || "Mi cuenta";

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("es-ES", { month: "long", year: "numeric" })
    : "";

  return (
    <Sheet>
      <SheetTrigger asChild>
        {variant === "row" ? (
          <button
            aria-label="Abrir perfil"
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-muted"
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2"
              style={{
                background: profile?.avatar_url ? "#0F0F0F" : "#E8542A",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                borderColor: "#F4EEE2",
              }}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{fullName}</div>
              <div className="truncate text-[11px] text-muted-foreground">Mi cuenta</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ) : (
          <button
            aria-label="Abrir perfil"
            className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 transition hover:scale-105 md:h-10 md:w-10"
            style={{
              background: profile?.avatar_url ? "#0F0F0F" : "#E8542A",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              borderColor: "#F4EEE2",
            }}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </button>
        )}
      </SheetTrigger>

      <SheetContent side="right" className="w-full max-w-sm overflow-y-auto p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Perfil</SheetTitle>
          <SheetDescription>Gestiona tu cuenta Pasify</SheetDescription>
        </SheetHeader>

        {/* Hero gradient + avatar */}
        <div
          className="relative px-6 pb-8 pt-12"
          style={{
            background: "linear-gradient(160deg, #E8542A 0%, #B8381A 60%, #0F0F0F 130%)",
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 48px)",
          }}
        >
          <div className="flex flex-col items-center">
            {/* Avatar grande + edit */}
            <div className="relative">
              <div
                className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4"
                style={{
                  background: profile?.avatar_url ? "#0F0F0F" : "rgba(244,238,226,0.15)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 36,
                  borderColor: "#F4EEE2",
                }}
              >
                {uploading ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              {/* Edit button overlay */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 transition hover:scale-110"
                style={{ background: "#F4EEE2", color: "#0F0F0F", borderColor: "#E8542A" }}
                aria-label="Cambiar foto"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleFileSelect}
              />
            </div>

            {/* Name */}
            <h2 className="mt-4 text-xl font-bold text-white text-center">{fullName}</h2>
            {profile?.email && (
              <p className="mt-0.5 text-xs text-white/75">{profile.email}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-white/85">
              {profile?.city && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 backdrop-blur">
                  <MapPin className="h-3 w-3" />
                  {profile.city}
                </span>
              )}
              {memberSince && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 backdrop-blur">
                  Miembro desde <span style={serif}>{memberSince}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Menu items */}
        <div className="space-y-1 p-4">
          <MenuItem icon={<Settings className="h-4 w-4" />} label="Ajustes de la cuenta" disabled hint="Próximamente" />
        </div>

        {/* Logout */}
        <div className="p-4 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
          <Button variant="outline" className="w-full" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

const MenuItem = ({
  icon,
  label,
  onClick,
  disabled,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
      disabled ? "opacity-50" : "hover:bg-muted"
    }`}
  >
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">{icon}</div>
    <div className="flex-1">
      <div className="font-medium">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
    <ChevronRight className="h-4 w-4 text-muted-foreground" />
  </button>
);

export default ProfileSheet;

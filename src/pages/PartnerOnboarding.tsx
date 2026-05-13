import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Store, CalendarPlus, Check, ArrowRight, Loader2, ImagePlus, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/haptics";
import { compressAvatar, compressPostImage } from "@/lib/imageUtils";

/**
 * Onboarding partner: 3 step obbligatori dopo registrazione + scelta piano.
 *   1. Logo (upload + preview)
 *   2. Profilo negozio (descrizione + categoria)
 *   3. Primo evento (form rapido — opzionale: skip allowed)
 *
 * Al completamento: profiles.onboarding_completed = true e
 * redirect a /partner-dashboard. PartnerGate consente l'accesso
 * solo se onboarding_completed === true.
 */

const STEPS = [
  { id: 1, label: "Logo", icon: Camera },
  { id: 2, label: "Negocio", icon: Store },
  { id: 3, label: "Evento", icon: CalendarPlus },
];

const PartnerOnboarding = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: logo
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");

  // Step 2: business profile
  const [description, setDescription] = useState("");
  const [businessImageFile, setBusinessImageFile] = useState<File | null>(null);
  const [businessImagePreview, setBusinessImagePreview] = useState<string>("");

  // Step 3: first event (opzionale)
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");

  // Carica eventuali dati esistenti del profilo
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      // Real column names on `profiles`: business_description (not
      // description) and cover_image_url (not business_image_url).
      const { data } = await supabase
        .from("profiles")
        .select("profile_image_url, business_description, cover_image_url, onboarding_completed")
        .eq("id", user.id)
        .single();
      if (data?.onboarding_completed) {
        navigate("/partner-dashboard", { replace: true });
        return;
      }
      if (data?.profile_image_url) setLogoPreview(data.profile_image_url);
      if (data?.business_description) setDescription(data.business_description);
      if (data?.cover_image_url) setBusinessImagePreview(data.cover_image_url);
    })();
  }, [user?.id, navigate]);

  const goNext = () => {
    haptic.light();
    setStep((s) => Math.min(STEPS.length, s + 1));
  };
  const goBack = () => {
    haptic.tap();
    setStep((s) => Math.max(1, s - 1));
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };
  const handleBusinessImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusinessImageFile(file);
    setBusinessImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (file: File, kind: "avatar" | "post") => {
    if (!user?.id) throw new Error("No user");
    const compressed = kind === "avatar" ? await compressAvatar(file) : await compressPostImage(file);
    // Pasify storage buckets:
    //  - avatars       → fotos de perfil (logo del local en partner)
    //  - event-images  → portadas de eventos, banners, cover del negocio
    // El bucket `posts` (legacy Pasify) fue eliminado.
    const bucket = kind === "avatar" ? "avatars" : "event-images";
    const fileName = `${user.id}/${kind}-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(fileName, compressed, {
      upsert: true,
      contentType: "image/jpeg",
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return data.publicUrl;
  };

  const finish = async (skipEvent = false) => {
    if (!user?.id) return;
    setSubmitting(true);
    try {
      // Upload logo se nuovo file
      let profileImageUrl: string | null = null;
      if (logoFile) profileImageUrl = await uploadImage(logoFile, "avatar");

      // Upload business image se nuovo file
      let businessImageUrl: string | null = null;
      if (businessImageFile) businessImageUrl = await uploadImage(businessImageFile, "post");

      // Update profile — column names match the live schema
      // (business_description, cover_image_url).
      const profileUpdate: Record<string, unknown> = {
        onboarding_completed: true,
        business_description: description.trim() || null,
      };
      if (profileImageUrl) profileUpdate.profile_image_url = profileImageUrl;
      if (businessImageUrl) profileUpdate.cover_image_url = businessImageUrl;

      const { error: profileErr } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", user.id);
      if (profileErr) throw profileErr;

      // Crea primo evento se compilato
      if (!skipEvent && eventTitle && eventStart && eventEnd) {
        const { error: eventErr } = await supabase.from("events").insert({
          partner_id: user.id,
          title: eventTitle.trim(),
          description: eventDescription.trim() || null,
          start_date: new Date(eventStart).toISOString(),
          end_date: new Date(eventEnd).toISOString(),
          type: "event",
          is_active: true,
          qr_enabled: true,
          daily_scan_limit: 1,
          discount_percentage: 0,
          event_category: "party",
        });
        if (eventErr) console.error("Event creation failed:", eventErr);
      }

      haptic.success();
      toast({ title: "¡Listo!", description: "Bienvenido a Pasify." });
      navigate("/partner-dashboard", { replace: true });
    } catch (err: unknown) {
      // Supabase returns plain objects (PostgrestError, StorageError) that
      // are NOT `instanceof Error`, so a naive check produced "Error
      // desconocido" for every real failure. Walk known shapes.
      console.error("[PartnerOnboarding] finish failed:", err);
      const e = err as {
        message?: string;
        error_description?: string;
        details?: string;
        hint?: string;
        code?: string;
      } | null;
      const msg =
        (err instanceof Error && err.message) ||
        e?.message ||
        e?.error_description ||
        e?.details ||
        e?.hint ||
        (e?.code ? `Error ${e.code}` : null) ||
        "Error desconocido";
      haptic.error();
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3 event fields are all-or-nothing: blocks the user from
  // submitting a half-filled event (which would silently skip the
  // insert and confusingly say "Listo!" without creating anything).
  const eventFilledCount = [eventTitle.trim(), eventStart, eventEnd].filter(Boolean).length;
  const eventFullyFilled = eventFilledCount === 3;
  const eventPartiallyFilled = eventFilledCount > 0 && eventFilledCount < 3;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-blue-50">
      {/* Stepper header */}
      <div
        className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto max-w-md px-5 py-4">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Paso {step} de {STEPS.length}
            </div>
            {/* Global "Saltar" — always available in the top-right.
                Skips event creation and finalizes the onboarding. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => finish(true)}
              disabled={submitting}
              className="h-7 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  Saltar
                  <SkipForward className="h-3 w-3" />
                </>
              )}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = step > s.id;
              const active = step === s.id;
              return (
                <div key={s.id} className="flex flex-1 items-center gap-2">
                  <div
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-all ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`h-1 flex-1 rounded-full ${done ? "bg-emerald-500" : "bg-muted"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto max-w-md px-5 pb-32 pt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h1 className="mb-1.5 text-2xl font-bold tracking-tight">
                    Sube tu logo
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Es lo primero que verán los estudiantes en tu perfil.
                  </p>
                </div>

                <label className="block cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-primary/30 bg-white transition hover:border-primary/60">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Logo" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Camera className="h-10 w-10" />
                        <span className="text-sm font-medium">Tocca para subir</span>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h1 className="mb-1.5 text-2xl font-bold tracking-tight">
                    Cuéntanos de tu negocio
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Una breve descripción + una foto del local ayudan a generar confianza.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descripción</Label>
                  <Textarea
                    id="description"
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ej: Bar de tapas en el centro con descuentos para estudiantes..."
                  />
                </div>

                <div className="space-y-2">
                  <Label>Foto del local (opcional)</Label>
                  <label className="block cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleBusinessImageSelect}
                    />
                    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-primary/30 bg-white transition hover:border-primary/60">
                      {businessImagePreview ? (
                        <img src={businessImagePreview} alt="Local" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <ImagePlus className="h-8 w-8" />
                          <span className="text-xs font-medium">Tocca para subir</span>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h1 className="mb-1.5 text-2xl font-bold tracking-tight">
                    Crea tu primer evento
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Rellena título, inicio y fin para crear el evento, o usa <strong>Saltar</strong> arriba a la derecha si lo prefieres más tarde.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event-title">Título</Label>
                  <Input
                    id="event-title"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="Ej: Cena estudiantes 20%"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event-description">Descripción</Label>
                  <Textarea
                    id="event-description"
                    rows={3}
                    value={eventDescription}
                    onChange={(e) => setEventDescription(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="event-start">Inicio</Label>
                    <Input
                      id="event-start"
                      type="datetime-local"
                      value={eventStart}
                      onChange={(e) => setEventStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="event-end">Fin</Label>
                    <Input
                      id="event-end"
                      type="datetime-local"
                      value={eventEnd}
                      onChange={(e) => setEventEnd(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sticky footer actions */}
      <div
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="mx-auto flex max-w-md gap-2 px-5 py-4">
          {step > 1 && (
            <Button variant="outline" onClick={goBack} disabled={submitting} className="flex-1 rounded-xl">
              Atrás
            </Button>
          )}
          {step < STEPS.length ? (
            <Button
              onClick={goNext}
              className="flex-1 rounded-xl"
              disabled={submitting || (step === 1 && !logoPreview)}
            >
              Siguiente
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            // Step 3 footer — only the "create event" action lives here.
            // Global "Saltar" stays in the top-right header (always
            // available). The button is disabled if the form is partially
            // filled to avoid the silent "submitted without inserting" trap.
            <Button
              onClick={() => finish(false)}
              disabled={submitting || eventPartiallyFilled || !eventFullyFilled}
              className="flex-1 rounded-xl"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : eventPartiallyFilled ? (
                "Rellena todos los campos"
              ) : (
                "Crear evento"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PartnerOnboarding;

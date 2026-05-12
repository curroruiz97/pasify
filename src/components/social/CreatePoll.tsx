import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, X, Plus, Image as ImageIcon, BarChart3, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { compressPostImage } from "@/lib/imageUtils";

interface CreatePollProps {
  userId: string;
  userProfile: any;
  onPollCreated: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  city?: string;
}

const CreatePoll = ({
  userId,
  userProfile,
  onPollCreated,
  open,
  onOpenChange,
  city,
}: CreatePollProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const getDisplayName = () => {
    if (userProfile?.first_name) return userProfile.first_name;
    if (userProfile?.business_name) return userProfile.business_name;
    return userProfile?.email?.split("@")[0] || "Tu";
  };

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setImageUrl(null);
  };

  const updateOption = (index: number, value: string) => {
    const next = [...options];
    next[index] = value;
    setOptions(next);
  };

  const addOption = () => {
    if (options.length >= 4) return;
    setOptions([...options, ""]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const compressed = await compressPostImage(file);
      const filePath = `${userId}/poll-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("posts")
        .upload(filePath, compressed, { cacheControl: "31536000" });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("posts").getPublicUrl(filePath);
      setImageUrl(publicUrl);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setImageUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanQuestion = question.trim();
    const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);

    if (!cleanQuestion) {
      toast({ title: "Falta la pregunta", description: "Escribe una pregunta para tu encuesta.", variant: "destructive" });
      return;
    }
    if (cleanOptions.length < 2) {
      toast({ title: "Mínimo 2 opciones", description: "Añade al menos 2 opciones de respuesta.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Insert poll
      const { data: pollData, error: pollErr } = await supabase
        .from("polls")
        .insert({
          user_id: userId,
          question: cleanQuestion,
          image_url: imageUrl,
          city: city || null,
          status: "approved",
        })
        .select()
        .single();

      if (pollErr) throw pollErr;

      // Insert options
      const optionsPayload = cleanOptions.map((text, position) => ({
        poll_id: pollData.id,
        text,
        position,
      }));

      const { error: optErr } = await supabase.from("poll_options").insert(optionsPayload);
      if (optErr) throw optErr;

      toast({ title: "Encuesta publicada", description: "Tu encuesta ya es visible en el feed." });

      // Push notification (non-blocking — ignora errori)
      supabase.functions
        .invoke("notify-new-poll", {
          body: {
            poll_id: pollData.id,
            actor_name: getDisplayName(),
            question: cleanQuestion,
            city: city || null,
          },
        })
        .catch((err) => console.warn("[CreatePoll] notify error:", err));

      reset();
      onOpenChange(false);
      onPollCreated();
    } catch (err: any) {
      console.error("[CreatePoll] error:", err);
      toast({ title: "Error", description: err.message || "No se pudo crear la encuesta.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[85vh] bg-white p-0">
        <DrawerHeader className="pb-2">
          <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
          <DrawerTitle className="text-center text-xl font-bold text-gray-900 flex items-center justify-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            Crear encuesta
          </DrawerTitle>
        </DrawerHeader>

        <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {/* User header */}
            <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
              <Avatar className="h-11 w-11">
                <AvatarImage src={userProfile?.profile_image_url} />
                <AvatarFallback className="bg-blue-500 text-white font-semibold">
                  {getDisplayName()[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-gray-900 text-sm">{getDisplayName()}</p>
                <p className="text-xs text-gray-500">Pública · {city || "Cualquier ciudad"}</p>
              </div>
            </div>

            {/* Question */}
            <div className="pt-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Pregunta
              </label>
              <Textarea
                placeholder="Hazle una pregunta a tu comunidad..."
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, 280))}
                className="mt-1 min-h-[70px] resize-none text-base bg-gray-50 border-gray-200 rounded-xl"
                disabled={loading}
                maxLength={280}
              />
              <div className="text-right text-xs text-gray-400 mt-1">{question.length}/280</div>
            </div>

            {/* Optional image */}
            <div className="mt-2">
              {imageUrl ? (
                <div className="relative rounded-2xl overflow-hidden bg-gray-100">
                  <img src={imageUrl} alt="" className="w-full max-h-60 object-cover" />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 text-blue-600 text-sm font-medium cursor-pointer hover:bg-blue-100/50 transition">
                  {imageUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                  <span>{imageUploading ? "Subiendo..." : "Añadir imagen (opcional)"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    disabled={imageUploading}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Options */}
            <div className="mt-5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Opciones (2-4)
              </label>
              <div className="mt-2 space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <Input
                        value={opt}
                        onChange={(e) => updateOption(i, e.target.value.slice(0, 80))}
                        placeholder={`Opción ${i + 1}`}
                        className="pr-10 bg-gray-50 border-gray-200 rounded-xl"
                        disabled={loading}
                        maxLength={80}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                        {opt.length}/80
                      </span>
                    </div>
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        className="p-2 text-gray-400 hover:text-red-500 transition"
                        disabled={loading}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {options.length < 4 && (
                <button
                  type="button"
                  onClick={addOption}
                  className="mt-2 flex items-center gap-1.5 text-sm text-blue-600 font-medium hover:text-blue-700"
                  disabled={loading}
                >
                  <Plus className="w-4 h-4" />
                  Añadir opción
                </button>
              )}
            </div>

            <p className="mt-4 text-xs text-gray-400 text-center">
              Una vez publicada, la encuesta no se puede modificar.
            </p>
          </div>

          {/* Submit */}
          <div className="p-4 border-t border-gray-100 bg-white">
            <Button
              type="submit"
              className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-full py-3 font-semibold text-base shadow-md flex items-center justify-center gap-2"
              disabled={loading || imageUploading || !question.trim() || options.filter(o => o.trim()).length < 2}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Publicando...
                </>
              ) : (
                "Publicar encuesta"
              )}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
};

export default CreatePoll;

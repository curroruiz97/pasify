import { useCallback, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, UploadCloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/imageUtils";
import { cn } from "@/lib/utils";

/**
 * PartnerImageUploader — uploader real para logo/portada del partner.
 *
 * - Sube a Supabase Storage en el bucket `partner-branding` con path
 *   `{org_id}/{kind}/{timestamp}-{rand}.{ext}`. La RLS (mig 0026 +
 *   0042) limita el write a owner/admin de la org.
 * - Devuelve la URL pública vía `onUploaded(url)`. El bucket es público
 *   tras la mig 0042 (logo/cover son brand assets públicos).
 * - Muestra preview inmediato (URL local + reemplazo cuando termina la
 *   subida). Soporta drag-and-drop.
 * - Variantes: "logo" (1:1 redondeado) y "cover" (16:9 ancho).
 * - Solo JPG, PNG y WebP (los demás se rechazan con un mensaje claro: un GIF
 *   o una foto HEIC no se ven igual en todas partes). Antes de subirla se
 *   reduce (logo hasta 512 px, portada hasta 1600×900) y se recomprime con
 *   `compressImage`: una foto del móvil pasa de varios MB a unos cientos de
 *   KB. Un PNG o un WebP siguen siéndolo, para que el logo sin fondo no se
 *   quede con uno blanco.
 * - Tamaño máximo 5MB por defecto (del archivo elegido, antes de reducirlo);
 *   rechaza con toast claro.
 *
 * Si `orgId` es null (caso: partner aún sin org creada al inicio del
 * wizard), el botón queda deshabilitado y guía al usuario.
 */

interface Props {
  orgId: string | null;
  kind: "logo" | "cover";
  value: string | null;
  onUploaded: (url: string) => void;
  onCleared?: () => void;
  label?: string;
  helperText?: string;
  maxSizeMB?: number;
  /** Texto a mostrar cuando no hay imagen. */
  emptyLabel?: string;
  /** ClassName adicional para el contenedor. */
  className?: string;
}

const mono: React.CSSProperties = {
  fontFamily: "'Geist Mono', ui-monospace, monospace",
  letterSpacing: "0.18em",
};

const randId = () => Math.random().toString(36).slice(2, 8);

/** Formatos que se admiten (y los que ofrece el selector de archivos; el GIF ya no). */
const TIPOS_ADMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;
type TipoAdmitido = (typeof TIPOS_ADMITIDOS)[number];
const ACCEPT = TIPOS_ADMITIDOS.join(",");

const esTipoAdmitido = (tipo: string): tipo is TipoAdmitido => (TIPOS_ADMITIDOS as readonly string[]).includes(tipo);

const EXTENSION: Record<TipoAdmitido, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Lado mayor tras reducirla: el logo se pinta a unos 180 px y la portada a menos de 1.000 px de ancho. */
const LADO_MAXIMO = { logo: { ancho: 512, alto: 512 }, cover: { ancho: 1600, alto: 900 } } as const;

/** Por qué no se admite un archivo, según lo que sea. */
const motivoNoAdmitido = (file: File): string => {
  const nombre = file.name.toLowerCase();
  if (/heic|heif/.test(file.type) || /\.(heic|heif)$/.test(nombre)) {
    return "Las fotos en formato HEIC no se admiten. Sube una imagen JPG, PNG o WebP.";
  }
  if (file.type === "image/gif" || nombre.endsWith(".gif")) {
    return "Los GIF no se admiten. Sube una imagen JPG, PNG o WebP.";
  }
  return "Sube una imagen JPG, PNG o WebP.";
};

export const PartnerImageUploader = ({
  orgId,
  kind,
  value,
  onUploaded,
  onCleared,
  label,
  helperText,
  maxSizeMB = 5,
  emptyLabel,
  className,
}: Props) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const isLogo = kind === "logo";

  const handleFile = useCallback(
    async (file: File) => {
      if (!orgId) {
        toast({
          title: "Crea primero tu organización",
          description: "Necesitamos guardar la organización antes de subir el logo/portada.",
          variant: "destructive",
        });
        return;
      }

      // Validación: tipo + tamaño
      if (!esTipoAdmitido(file.type)) {
        toast({
          title: "Formato no válido",
          description: motivoNoAdmitido(file),
          variant: "destructive",
        });
        return;
      }
      const sizeMB = file.size / (1024 * 1024);
      if (sizeMB > maxSizeMB) {
        toast({
          title: "Archivo demasiado grande",
          description: `Máximo ${maxSizeMB}MB. El tuyo pesa ${sizeMB.toFixed(1)}MB.`,
          variant: "destructive",
        });
        return;
      }

      // Preview local inmediato — UX instantánea mientras sube.
      const reader = new FileReader();
      reader.onload = () => setLocalPreview(reader.result as string);
      reader.readAsDataURL(file);

      setUploading(true);
      try {
        // Se reduce y se recomprime en el mismo formato (JPEG sigue siendo
        // JPEG; PNG y WebP conservan su transparencia).
        const lado = LADO_MAXIMO[kind];
        let blob: Blob;
        try {
          blob = await compressImage(file, {
            maxWidth: lado.ancho,
            maxHeight: lado.alto,
            quality: 0.85,
            outputType: file.type,
          });
        } catch {
          throw new Error("No hemos podido leer la imagen: puede que esté dañada. Prueba con otra JPG, PNG o WebP.");
        }
        // Se sube con el formato que ha salido de verdad (Safari sin WebP saca PNG).
        const tipo = esTipoAdmitido(blob.type) ? blob.type : "image/jpeg";
        const path = `${orgId}/${kind}/${Date.now()}-${randId()}.${EXTENSION[tipo]}`;
        const { error } = await supabase.storage
          .from("partner-branding")
          .upload(path, blob, {
            cacheControl: "3600",
            upsert: false,
            contentType: tipo,
          });
        if (error) throw error;

        const { data } = supabase.storage.from("partner-branding").getPublicUrl(path);
        onUploaded(data.publicUrl);
        toast({
          title: "Imagen subida",
          description: isLogo ? "Logo actualizado." : "Portada actualizada.",
        });
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? "Error al subir";
        toast({ title: "No se pudo subir", description: msg, variant: "destructive" });
        setLocalPreview(null);
      } finally {
        setUploading(false);
      }
    },
    [orgId, kind, maxSizeMB, onUploaded, toast, isLogo]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleClear = () => {
    setLocalPreview(null);
    if (inputRef.current) inputRef.current.value = "";
    onCleared?.();
  };

  const visible = localPreview ?? value;
  const hasImage = Boolean(visible);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && (
        <span className="text-[10px] uppercase text-muted-foreground" style={mono}>
          {label}
        </span>
      )}

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "group relative overflow-hidden rounded-2xl border-2 border-dashed bg-card/40 transition-all",
          "hover:border-primary/60 hover:bg-card/60",
          dragOver && "border-primary bg-primary/5",
          uploading && "pointer-events-none",
          !orgId && "opacity-60",
          isLogo ? "aspect-square w-full max-w-[180px]" : "aspect-[16/9] w-full",
          hasImage ? "border-border/60" : "border-border"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />

        {hasImage ? (
          <>
            <img
              src={visible!}
              alt={isLogo ? "Logo" : "Portada"}
              className={cn(
                "h-full w-full object-cover transition-transform group-hover:scale-[1.02]",
                isLogo && "rounded-2xl"
              )}
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading || !orgId}
                className="inline-flex items-center gap-2 rounded-full bg-primary/95 px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[0_12px_30px_-10px_rgba(232,84,42,0.55)] transition hover:-translate-y-0.5"
                style={mono}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Reemplazar
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
                style={mono}
                aria-label="Quitar imagen"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Quitar
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || !orgId}
            className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center"
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
                <ImagePlus className="h-5 w-5" />
              </div>
            )}
            <span className="text-sm font-medium text-foreground">
              {emptyLabel ?? (isLogo ? "Sube tu logo" : "Sube tu portada")}
            </span>
            <span
              className="text-[10px] uppercase text-muted-foreground"
              style={mono}
            >
              {orgId
                ? `Arrastra o haz click · JPG, PNG o WebP · máx ${maxSizeMB}MB`
                : "Disponible al crear la organización"}
            </span>
          </button>
        )}

        {uploading && hasImage && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-[10px] uppercase" style={mono}>
                Subiendo…
              </span>
            </div>
          </div>
        )}
      </div>

      {helperText && (
        <span className="text-[11px] text-muted-foreground">{helperText}</span>
      )}
    </div>
  );
};

export default PartnerImageUploader;

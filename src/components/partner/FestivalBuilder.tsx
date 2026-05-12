import { useState } from "react";
import {
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Music,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export interface FestivalDay {
  id: string;
  date: string;
  title: string;
  headliner: string;
  priceCents: number;
}

export interface FestivalDraft {
  id: string;
  name: string;
  description: string;
  city: string;
  startDate: string;
  endDate: string;
  days: FestivalDay[];
  passPriceCents: number;
}

const newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `f_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const emptyDraft = (): FestivalDraft => {
  const today = new Date();
  return {
    id: newId(),
    name: "",
    description: "",
    city: "",
    startDate: format(today, "yyyy-MM-dd"),
    endDate: format(today, "yyyy-MM-dd"),
    days: [],
    passPriceCents: 12000,
  };
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate?: (draft: FestivalDraft) => void;
}

/**
 * FestivalBuilder — wizard de creación de festival multi-día.
 * Genera N eventos hijos (uno por día) + un pase combinado a precio
 * descuento. UI mock; el guardado real será cuando Supabase admita
 * el modelo Festival → FestivalDay → Event.
 */
export const FestivalBuilder = ({ open, onOpenChange, onCreate }: Props) => {
  const [draft, setDraft] = useState<FestivalDraft>(emptyDraft);

  const addDay = () => {
    const lastDate = draft.days.length > 0 ? draft.days[draft.days.length - 1].date : draft.startDate;
    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + 1);
    setDraft((d) => ({
      ...d,
      days: [
        ...d.days,
        {
          id: newId(),
          date: format(nextDate, "yyyy-MM-dd"),
          title: `Día ${d.days.length + 1}`,
          headliner: "",
          priceCents: 4500,
        },
      ],
      endDate: format(nextDate, "yyyy-MM-dd"),
    }));
  };

  const removeDay = (id: string) =>
    setDraft((d) => ({ ...d, days: d.days.filter((day) => day.id !== id) }));

  const updateDay = (id: string, patch: Partial<FestivalDay>) =>
    setDraft((d) => ({
      ...d,
      days: d.days.map((day) => (day.id === id ? { ...day, ...patch } : day)),
    }));

  const totalIndividual = draft.days.reduce((s, d) => s + d.priceCents, 0);
  const savings = totalIndividual - draft.passPriceCents;
  const savingsPct = totalIndividual > 0 ? Math.round((savings / totalIndividual) * 100) : 0;

  const submit = () => {
    onCreate?.(draft);
    setDraft(emptyDraft());
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-background/90 backdrop-blur-md overflow-y-auto">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(120px)" }}
      />

      <div className="relative my-auto flex w-full max-w-3xl flex-col">
        <header className="flex items-center justify-between px-5 pt-6 md:px-8 md:pt-8">
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Sparkles className="h-3 w-3" />
            Pasify · Festival builder
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-8 md:px-8 md:py-10">
          {/* Hero */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="relative mb-5 flex h-16 w-16 items-center justify-center">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
                style={{ background: "rgba(232,84,42,0.3)" }}
              />
              <div
                className="relative flex h-16 w-16 items-center justify-center rounded-2xl text-white"
                style={{
                  background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.6)",
                }}
              >
                <Music className="h-7 w-7" />
              </div>
            </div>
            <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
              Monta tu <span style={serif} className="text-orange-500">festival</span>.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Crea un evento padre con sus días, line-up y pase combinado en un solo flow. Cada día queda como sub-evento independiente.
            </p>
          </div>

          {/* Form */}
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-xs">Nombre del festival</Label>
                <Input
                  className="mt-1.5 h-11 rounded-xl"
                  placeholder="Medusa Festival"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Ciudad</Label>
                <Input
                  className="mt-1.5 h-11 rounded-xl"
                  placeholder="Valencia"
                  value={draft.city}
                  onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Pase festival (€)</Label>
                <Input
                  className="mt-1.5 h-11 rounded-xl"
                  type="number"
                  step="1"
                  value={(draft.passPriceCents / 100).toFixed(0)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      passPriceCents: Math.round(parseFloat(e.target.value || "0") * 100),
                    }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Descripción corta</Label>
                <Textarea
                  className="mt-1.5 min-h-[88px] rounded-xl"
                  placeholder="El festival electrónico más grande del sur de Europa."
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </div>
            </div>

            {/* Días */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div
                    className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                    style={{ ...mono, letterSpacing: "0.2em" }}
                  >
                    <Calendar className="h-3 w-3" />
                    Días · {draft.days.length.toString().padStart(2, "0")}
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    Programación día a día
                  </h3>
                </div>
                <Button size="sm" onClick={addDay} variant="outline">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Añadir día
                </Button>
              </div>

              {draft.days.length === 0 ? (
                <div
                  className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
                  style={mono}
                >
                  Aún no has añadido días. Pulsa "Añadir día" para empezar.
                </div>
              ) : (
                <div className="space-y-3">
                  {draft.days.map((day, idx) => (
                    <div
                      key={day.id}
                      className="rounded-xl border border-border bg-background/40 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase"
                          style={{
                            ...mono,
                            letterSpacing: "0.18em",
                            background: "rgba(232,84,42,0.18)",
                            color: "#FF7A4D",
                          }}
                        >
                          Día {(idx + 1).toString().padStart(2, "0")}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeDay(day.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-red-400"
                          aria-label="Eliminar día"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <div>
                          <Label className="text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.14em" }}>
                            Fecha
                          </Label>
                          <Input
                            type="date"
                            className="mt-1 h-9 rounded-lg text-xs"
                            value={day.date}
                            onChange={(e) => updateDay(day.id, { date: e.target.value })}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Label className="text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.14em" }}>
                            Headliner
                          </Label>
                          <Input
                            className="mt-1 h-9 rounded-lg text-xs"
                            placeholder="Headliner principal"
                            value={day.headliner}
                            onChange={(e) => updateDay(day.id, { headliner: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.14em" }}>
                            Precio (€)
                          </Label>
                          <Input
                            type="number"
                            className="mt-1 h-9 rounded-lg text-xs"
                            value={(day.priceCents / 100).toFixed(0)}
                            onChange={(e) =>
                              updateDay(day.id, {
                                priceCents: Math.round(parseFloat(e.target.value || "0") * 100),
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Resumen */}
            {draft.days.length > 0 && (
              <section
                className="rounded-2xl p-5"
                style={{
                  background: "linear-gradient(160deg, rgba(232,84,42,0.12), rgba(184,56,26,0.02))",
                  border: "1px solid rgba(232,84,42,0.3)",
                }}
              >
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <ResumeCell
                    label="Días"
                    value={draft.days.length.toString().padStart(2, "0")}
                  />
                  <ResumeCell
                    label="Suma individual"
                    value={`${(totalIndividual / 100).toFixed(0)}€`}
                  />
                  <ResumeCell
                    label="Pase completo"
                    value={`${(draft.passPriceCents / 100).toFixed(0)}€`}
                    highlight
                  />
                  <ResumeCell
                    label="Ahorro pase"
                    value={savings >= 0 ? `${(savings / 100).toFixed(0)}€ · ${savingsPct}%` : "—"}
                  />
                </div>
              </section>
            )}
          </div>
        </main>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-8">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <button
            type="button"
            disabled={!draft.name || draft.days.length === 0}
            onClick={submit}
            className="group/btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            Crear festival
          </button>
        </footer>
      </div>
    </div>
  );
};

const ResumeCell = ({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) => (
  <div>
    <div
      className="text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.18em", color: highlight ? "#FF7A4D" : "#8A8275" }}
    >
      {label}
    </div>
    <div
      className={`mt-1 ${highlight ? "text-2xl font-bold" : "text-lg font-semibold"} tracking-tight text-foreground`}
      style={mono}
    >
      {value}
    </div>
  </div>
);

export default FestivalBuilder;

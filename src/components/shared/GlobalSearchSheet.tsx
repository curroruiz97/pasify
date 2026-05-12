import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Calendar, Store, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/ui/empty-state";
import { optimizedImage } from "@/lib/image";

/**
 * Search globale: bottom sheet con input + risultati raggruppati
 * (eventi e partner). Debounce 250ms, RPC `global_search`.
 *
 * Triggerare da qualunque header con un bottone search:
 *   const [open, setOpen] = useState(false);
 *   <GlobalSearchSheet open={open} onOpenChange={setOpen} city={...} />
 */

interface SearchResult {
  result_type: "event" | "partner";
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  partner_id: string;
}

interface GlobalSearchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  city?: string;
}

export const GlobalSearchSheet = ({ open, onOpenChange, city }: GlobalSearchSheetProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("global_search", {
          _query: query,
          _city: city || null,
          _limit: 8,
        });
        if (error) throw error;
        setResults((data as SearchResult[]) || []);
      } catch (err) {
        console.error("[GlobalSearch] error:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query, open, city]);

  // Reset al close
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  const handleClick = (r: SearchResult) => {
    onOpenChange(false);
    if (r.result_type === "partner") {
      navigate(`/partner/${r.partner_id}`);
    } else {
      // Per gli eventi navighiamo al partner, l'evento sarà visibile
      // tra le sue card. (Non c'è una pagina dedicata evento.)
      navigate(`/partner/${r.partner_id}`);
    }
  };

  const events = results.filter((r) => r.result_type === "event");
  const partners = results.filter((r) => r.result_type === "partner");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] h-[85vh]">
        <div className="flex-shrink-0 px-5 pt-2 pb-3">
          <SheetHeader>
            <SheetTitle className="text-left text-xl font-bold tracking-tight">
              Buscar
            </SheetTitle>
          </SheetHeader>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Eventos, locales, descuentos..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="mx-5 h-px flex-shrink-0 bg-border" />

        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <EmptyState
              icon={Search}
              title="Sin resultados"
              description={`No encontramos nada para "${query}".`}
            />
          )}

          {!loading && query.trim().length < 2 && (
            <EmptyState
              icon={Search}
              title="Empieza a escribir"
              description="Busca eventos, locales o descuentos en tu ciudad."
              variant="primary"
            />
          )}

          {!loading && events.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Eventos
              </h3>
              <ul className="space-y-2">
                {events.map((r) => (
                  <li key={`event-${r.id}`}>
                    <button
                      onClick={() => handleClick(r)}
                      className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition hover:bg-muted/40"
                    >
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
                        {r.image_url ? (
                          <img
                            src={optimizedImage(r.image_url, "thumb")}
                            alt={r.title}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Calendar className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.title}</p>
                        {r.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && partners.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Locales
              </h3>
              <ul className="space-y-2">
                {partners.map((r) => (
                  <li key={`partner-${r.id}`}>
                    <button
                      onClick={() => handleClick(r)}
                      className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition hover:bg-muted/40"
                    >
                      <Avatar className="h-12 w-12 flex-shrink-0">
                        <AvatarImage
                          src={optimizedImage(r.image_url, "avatar") || undefined}
                          alt={r.title}
                        />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          <Store className="h-5 w-5" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.title}</p>
                        {r.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

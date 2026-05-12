import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, MessageSquare, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { haptic } from "@/lib/haptics";
import { EmptyState } from "@/components/ui/empty-state";
import { format } from "date-fns";

interface Review {
  rating: number;
  comment: string | null;
  created_at: string;
  profiles?: {
    first_name?: string;
    last_name?: string;
  };
}

interface PartnerReviewsProps {
  partnerId: string;
  reviews: Review[];
  onReviewAdded: () => void;
}

const PartnerReviews = ({ partnerId, reviews, onReviewAdded }: PartnerReviewsProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);

  // Aggregato media + count: utile in header del componente.
  const { avg, count } = useMemo(() => {
    if (!reviews?.length) return { avg: 0, count: 0 };
    const sum = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return { avg: sum / reviews.length, count: reviews.length };
  }, [reviews]);

  const handleSubmit = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        title: "Errore",
        description: "Devi essere autenticato per lasciare una recensione",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase
      .from("reviews")
      .insert({ partner_id: partnerId, client_id: user.id, rating, comment: comment.trim() || null });

    if (error) {
      haptic.error();
      toast({
        title: "Errore",
        description: "Impossibile salvare la recensione",
        variant: "destructive",
      });
    } else {
      haptic.success();
      toast({
        title: "Recensione pubblicata!",
        description: "Grazie per il tuo feedback",
      });
      setShowForm(false);
      setComment("");
      setRating(5);
      onReviewAdded();
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {/* Aggregate header */}
      {count > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
          <div className="flex flex-col items-center justify-center rounded-2xl bg-amber-50 px-4 py-2 dark:bg-amber-950/30">
            <span className="text-3xl font-bold tabular-nums leading-none text-amber-600 dark:text-amber-400">
              {avg.toFixed(1)}
            </span>
            <div className="mt-1 flex gap-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`h-3 w-3 ${
                    s <= Math.round(avg)
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {count} {count === 1 ? "recensione" : "recensioni"}
            </p>
            <p className="text-xs text-muted-foreground">
              Media basata sulle valutazioni degli studenti
            </p>
          </div>
        </div>
      )}

      {/* CTA */}
      {!showForm && (
        <Button
          onClick={() => {
            haptic.tap();
            setShowForm(true);
          }}
          className="w-full ios-button h-12 rounded-xl"
          variant="outline"
        >
          <MessageSquare className="w-5 h-5 mr-2" />
          {t("partner.leaveReview")}
        </Button>
      )}

      {/* Form */}
      {showForm && (
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          <h3 className="font-bold">{t("partner.leaveYourReview")}</h3>

          {/* Stars */}
          <div className="flex justify-center gap-2 py-2">
            {[1, 2, 3, 4, 5].map((star) => {
              const filled = (hoverRating || rating) >= star;
              return (
                <button
                  key={star}
                  onClick={() => {
                    haptic.selection();
                    setRating(star);
                  }}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="transition-transform active:scale-90"
                  aria-label={`Rate ${star} stars`}
                >
                  <Star
                    className={`h-9 w-9 transition-colors ${
                      filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <Textarea
            placeholder="Cuéntanos tu experiencia (opcional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="ios-input min-h-24"
          />

          <div className="flex gap-2">
            <Button
              onClick={() => {
                haptic.tap();
                setShowForm(false);
              }}
              variant="outline"
              className="flex-1 rounded-xl"
            >
              Annulla
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 rounded-xl">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pubblica"}
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {reviews.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Sin reseñas todavía"
          description="Sé el primero en dejar una valoración a este local."
        />
      ) : (
        <ul className="space-y-3">
          {reviews.map((review, index) => {
            const fullName = [review.profiles?.first_name, review.profiles?.last_name]
              .filter(Boolean)
              .join(" ") || "Estudiante";
            return (
              <li key={index} className="rounded-2xl border bg-card p-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{fullName}</p>
                    <div className="mt-0.5 flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-3.5 w-3.5 ${
                            s <= review.rating
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                    {format(new Date(review.created_at), "d MMM yyyy")}
                  </span>
                </div>
                {review.comment && (
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {review.comment}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default PartnerReviews;

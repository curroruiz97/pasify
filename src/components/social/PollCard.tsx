import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BarChart3, Check, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface PollOption {
  id: string;
  text: string;
  position: number;
  votes_count: number;
}

interface Voter {
  user_id: string;
  option_id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  profile_image_url: string | null;
}

interface PollCardProps {
  poll: {
    id: string;
    user_id: string;
    question: string;
    image_url: string | null;
    created_at: string;
    profiles?: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      business_name: string | null;
      profile_image_url: string | null;
    } | null;
  };
  currentUserId: string;
}

const PollCard = ({ poll, currentUserId }: PollCardProps) => {
  const { toast } = useToast();
  const [options, setOptions] = useState<PollOption[]>([]);
  const [myVoteOptionId, setMyVoteOptionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [expandedOption, setExpandedOption] = useState<string | null>(null);

  const totalVotes = options.reduce((sum, o) => sum + o.votes_count, 0);
  const hasVoted = myVoteOptionId !== null;

  const author = poll.profiles;
  const displayName =
    author?.first_name
      ? `${author.first_name} ${author.last_name || ""}`.trim()
      : author?.business_name || "Usuario";
  const initials = displayName
    .split(" ")
    .map((p) => p[0]?.toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join("") || "?";

  const fetchData = async () => {
    setLoading(true);
    try {
      const [{ data: opts }, { data: myVote }, { data: votesData }] = await Promise.all([
        supabase
          .from("poll_options_with_counts")
          .select("id, poll_id, text, position, votes_count")
          .eq("poll_id", poll.id)
          .order("position"),
        supabase
          .from("poll_votes")
          .select("option_id")
          .eq("poll_id", poll.id)
          .eq("user_id", currentUserId)
          .maybeSingle(),
        supabase
          .from("poll_votes")
          .select("user_id, option_id, created_at")
          .eq("poll_id", poll.id)
          .order("created_at", { ascending: false }),
      ]);
      setOptions(opts || []);
      setMyVoteOptionId(myVote?.option_id || null);

      // poll_votes.user_id FK punta ad auth.users, non public.profiles → join manuale
      const voterIds = Array.from(new Set((votesData || []).map((v) => v.user_id)));
      let profilesMap = new Map<string, Omit<Voter, "user_id" | "option_id">>();
      if (voterIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, business_name, profile_image_url")
          .in("id", voterIds);
        profilesMap = new Map(
          (profilesData || []).map((p) => [
            p.id,
            {
              first_name: p.first_name,
              last_name: p.last_name,
              business_name: p.business_name,
              profile_image_url: p.profile_image_url,
            },
          ]),
        );
      }
      const flatVoters: Voter[] = (votesData || []).map((v) => {
        const prof = profilesMap.get(v.user_id);
        return {
          user_id: v.user_id,
          option_id: v.option_id,
          first_name: prof?.first_name ?? null,
          last_name: prof?.last_name ?? null,
          business_name: prof?.business_name ?? null,
          profile_image_url: prof?.profile_image_url ?? null,
        };
      });
      setVoters(flatVoters);
    } catch (err) {
      console.error("[PollCard] fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Realtime subscription per votazioni
    const channel = supabase
      .channel(`poll-${poll.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "poll_votes", filter: `poll_id=eq.${poll.id}` },
        () => fetchData(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.id, currentUserId]);

  const handleVote = async (optionId: string) => {
    if (hasVoted || voting) return;
    setVoting(true);
    try {
      const { error } = await supabase
        .from("poll_votes")
        .insert({ poll_id: poll.id, option_id: optionId, user_id: currentUserId });
      if (error) throw error;
      // Optimistic update
      setMyVoteOptionId(optionId);
      setOptions((prev) =>
        prev.map((o) => (o.id === optionId ? { ...o, votes_count: o.votes_count + 1 } : o)),
      );
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "No se pudo votar.", variant: "destructive" });
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <Avatar className="h-11 w-11 ring-2 ring-blue-100">
          <AvatarImage src={author?.profile_image_url || undefined} alt={displayName} />
          <AvatarFallback className="bg-blue-500 text-white text-sm font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 truncate">{displayName}</div>
          <div className="text-xs text-gray-500">
            {formatDistanceToNow(new Date(poll.created_at), { addSuffix: true, locale: es })}
          </div>
        </div>
        <div className="flex items-center gap-1 text-blue-500 bg-blue-50 px-2.5 py-1 rounded-full text-xs font-semibold">
          <BarChart3 className="w-3.5 h-3.5" />
          Encuesta
        </div>
      </div>

      {/* Question */}
      <h3 className="text-base font-semibold text-gray-900 mb-3 leading-snug">
        {poll.question}
      </h3>

      {/* Image */}
      {poll.image_url && (
        <div className="rounded-xl overflow-hidden mb-3 bg-gray-100">
          <img
            src={poll.image_url}
            alt=""
            className="w-full max-h-80 object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Options */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {options.map((opt) => {
            const pct = totalVotes > 0 ? Math.round((opt.votes_count / totalVotes) * 100) : 0;
            const selected = myVoteOptionId === opt.id;
            const optionVoters = voters.filter((v) => v.option_id === opt.id);
            const isExpanded = expandedOption === opt.id;

            return (
              <div key={opt.id} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => handleVote(opt.id)}
                  disabled={hasVoted || voting}
                  className={`relative w-full overflow-hidden rounded-xl border transition-all ${
                    selected
                      ? "border-blue-500 bg-blue-50"
                      : hasVoted
                      ? "border-gray-200 bg-gray-50"
                      : "border-blue-200 bg-white hover:bg-blue-50 active:scale-[0.99] cursor-pointer"
                  }`}
                >
                  {hasVoted && (
                    <div
                      className={`absolute inset-y-0 left-0 transition-all duration-500 ${
                        selected ? "bg-blue-500/20" : "bg-gray-200/60"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  )}

                  <div className="relative flex items-center gap-3 px-4 py-3">
                    {selected && (
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </span>
                    )}

                    <span
                      className={`flex-1 text-left text-sm font-medium ${
                        selected ? "text-blue-900" : "text-gray-800"
                      }`}
                    >
                      {opt.text}
                    </span>

                    {hasVoted && (
                      <div className="flex items-center gap-2 text-xs text-gray-600 flex-shrink-0">
                        <span className="font-semibold">{opt.votes_count}</span>
                        <span className="text-gray-400">·</span>
                        <span className="font-bold text-gray-900 w-9 text-right">{pct}%</span>
                      </div>
                    )}
                  </div>
                </button>

                {/* Lista votanti — visibile solo dopo voto, per non influenzare */}
                {hasVoted && optionVoters.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedOption(isExpanded ? null : opt.id)}
                    className="flex w-full items-center gap-2 px-3 py-1 text-left transition hover:bg-blue-50/40 rounded-lg"
                  >
                    <div className="flex -space-x-2">
                      {optionVoters.slice(0, 4).map((v) => (
                        <Avatar key={v.user_id} className="h-5 w-5 ring-2 ring-white">
                          <AvatarImage src={v.profile_image_url || undefined} />
                          <AvatarFallback className="bg-blue-400 text-[9px] text-white">
                            {(v.first_name || v.business_name || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                    <span className="text-[11px] text-gray-500 group-hover:text-blue-600">
                      {isExpanded ? "Ocultar votantes" : `Ver ${optionVoters.length} ${optionVoters.length === 1 ? "votante" : "votantes"}`}
                    </span>
                  </button>
                )}

                {hasVoted && isExpanded && optionVoters.length > 0 && (
                  <div className="ml-3 space-y-1.5 rounded-lg border border-blue-100 bg-blue-50/30 p-2">
                    {optionVoters.map((v) => {
                      const name =
                        v.first_name
                          ? `${v.first_name} ${v.last_name || ""}`.trim()
                          : v.business_name || "Usuario";
                      return (
                        <div key={v.user_id} className="flex items-center gap-2 text-xs">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={v.profile_image_url || undefined} />
                            <AvatarFallback className="bg-blue-400 text-[10px] text-white">
                              {name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-gray-700">{name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: total votes */}
      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
        <Users className="w-3.5 h-3.5" />
        <span>
          {totalVotes} {totalVotes === 1 ? "voto" : "votos"}
        </span>
        {!hasVoted && totalVotes > 0 && (
          <span className="text-blue-500 font-medium ml-2">· Vota para ver los resultados</span>
        )}
      </div>
    </div>
  );
};

export default PollCard;

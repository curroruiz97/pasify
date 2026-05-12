import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { usePostsFlat, useInvalidatePosts, useOptimisticLike } from "@/hooks/usePosts";
import { useAllEvents, useInvalidateEvents } from "@/hooks/useEvents";
import { usePolls, useInvalidatePolls } from "@/hooks/usePolls";
import { useWebNotifications } from "@/hooks/useWebNotifications";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, X, ChevronDown, MapPin } from "lucide-react";
import CreatePost from "@/components/social/CreatePost";
import PostCard from "@/components/social/PostCard";
import { PostCardSkeleton, SkeletonList } from "@/components/ui/skeletons";
import EventCard from "@/components/social/EventCard";
import PollCard from "@/components/social/PollCard";
import SettingsSheet from "@/components/partner/SettingsSheet";
import AccountSwitcherSheet from "@/components/social/AccountSwitcherSheet";
import CitySelector from "@/components/social/CitySelector";
import { DEFAULT_CITY } from "@/constants/spanishCities";
import { DEFAULT_COUNTRY, getCountryByCode } from "@/constants/countries";
import { useTranslation } from "react-i18next";
import SwipeBackWrapper from "@/components/shared/SwipeBackWrapper";

const Social = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [citySelectorOpen, setCitySelectorOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string>(() => {
    return localStorage.getItem("selectedCountry") || DEFAULT_COUNTRY;
  });
  const [selectedCity, setSelectedCity] = useState<string>(() => {
    return localStorage.getItem("selectedCity") || DEFAULT_CITY;
  });

  // Multi-account
  const { saveCurrentAccount, savedAccounts } = useMultiAccount();

  // React Query hooks for posts and events
  const { data: posts, isLoading: postsLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = usePostsFlat(selectedCity, selectedCountry);
  const { data: events = [], isLoading: eventsLoading } = useAllEvents(selectedCity, selectedCountry);
  const { data: polls = [] } = usePolls(selectedCity, selectedCountry);
  const { invalidatePosts } = useInvalidatePosts();
  const { invalidateAll: invalidateEvents } = useInvalidateEvents();
  const invalidatePolls = useInvalidatePolls();
  const optimisticLike = useOptimisticLike();

  const loading = postsLoading && posts.length === 0;

  // Infinite scroll: observe sentinel element at bottom of feed
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  // Abilita notifiche web
  useWebNotifications({ userId: user?.id });

  useEffect(() => {
    checkAuth();
  }, []);

  // Subscription per nuovi post in tempo reale, filtered by selected city
  useEffect(() => {
    if (!profile || !selectedCity) return;

    const channel = supabase
      .channel(`posts-changes-social-${selectedCity}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "posts",
          filter: `city=eq.${selectedCity}`,
        },
        () => {
          console.log("[Social] New post detected, invalidating cache");
          invalidatePosts();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "posts",
          filter: `city=eq.${selectedCity}`,
        },
        (payload) => {
          if (payload.new && (payload.new as any).status === "approved") {
            console.log("[Social] Post approved, invalidating cache");
            invalidatePosts();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "posts",
          filter: `city=eq.${selectedCity}`,
        },
        () => {
          console.log("[Social] Post deleted, invalidating cache");
          invalidatePosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, selectedCity, invalidatePosts]);

  // Subscription per eventi in tempo reale, filtered by city, INSERT only
  useEffect(() => {
    if (!profile || !selectedCity) return;

    const channel = supabase
      .channel(`events-changes-social-${selectedCity}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `city=eq.${selectedCity}`,
        },
        () => {
          console.log("[Social] New event detected, invalidating cache");
          invalidateEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, selectedCity, invalidateEvents]);

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    localStorage.setItem("selectedCountry", country);
  };

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    localStorage.setItem("selectedCity", city);
  };

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      navigate("/login");
      return;
    }

    setUser(user);

    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    setProfile(profileData);

    // Salva l'account corrente per il multi-account
    if (profileData) {
      saveCurrentAccount({ ...profileData, email: user.email });
    }
  };

  const handlePostCreated = () => {
    invalidatePosts();
    invalidatePolls();
  };

  const handlePostDeleted = (postId: string) => {
    // Optimistic update: remove from infinite query cache
    queryClient.setQueriesData<any>(
      { predicate: (query) => query.queryKey[0] === "posts" },
      (oldData: any) => {
        if (!oldData?.pages) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page: any[]) =>
            page.filter((p) => p.id !== postId)
          ),
        };
      }
    );
  };

  const handleLikeToggle = (postId: string, isLiked: boolean) => {
    if (user?.id) {
      optimisticLike(postId, user.id, isLiked);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);

    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, business_name, profile_image_url")
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,business_name.ilike.%${query}%`)
      .limit(10);

    setSearchResults(data || []);
    setSearching(false);
  };

  const getDisplayName = (profile: any) => {
    if (profile.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile.business_name || "Utente";
  };

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Caricamento...</p>
        </div>
      </div>
    );
  }

  return (
    <SwipeBackWrapper>
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="max-w-[470px] mx-auto w-full">
        {/* Header */}
        <div className="bg-white mx-4 mt-4 p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            {/* City Selector */}
            <button
              onClick={() => profile?.user_type !== "partner" && setCitySelectorOpen(true)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all ${
                profile?.user_type === "partner"
                  ? "bg-gray-100 cursor-default"
                  : "bg-gradient-to-r from-primary/10 to-primary/5 hover:from-primary/20 hover:to-primary/10 active:scale-95"
              }`}
            >
              <MapPin className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm">{selectedCity}</span>
              {profile?.user_type !== "partner" && (
                <ChevronDown className="w-3 h-3 text-gray-400" />
              )}
            </button>

            {/* Avatar con indicatore multi-account */}
            <button
              onClick={() => setAccountSwitcherOpen(true)}
              className="flex items-center gap-1 hover:opacity-80 transition-all active:scale-95"
            >
              <div className="relative">
                <Avatar className="h-10 w-10 ring-2 ring-blue-100 hover:ring-blue-300 transition-all">
                  <AvatarImage src={profile?.profile_image_url} />
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-semibold">
                    {getDisplayName(profile)[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {/* Badge numero account se più di 1 */}
                {savedAccounts.length > 1 && (
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold shadow-lg">
                    {savedAccounts.length}
                  </div>
                )}
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder={t("search.users")}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10 pr-10 border-gray-200 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* Search Results */}
          {searchQuery && (
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {searching ? (
                <p className="text-sm text-gray-500 text-center py-4">{t("search.searching")}</p>
              ) : searchResults.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">{t("search.noUsersFound")}</p>
              ) : (
                searchResults.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => {
                      navigate(`/profile/${result.id}`);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={result.profile_image_url} />
                      <AvatarFallback className="bg-blue-500 text-white">
                        {getDisplayName(result)[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                      <p className="font-semibold">{getDisplayName(result)}</p>
                      {result.first_name && result.business_name && (
                        <p className="text-xs text-gray-500">{result.business_name}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>



        {/* Create Post */}
        <div className="mx-4 mt-4">
          <CreatePost
            userId={user.id}
            userProfile={profile}
            onPostCreated={handlePostCreated}
            city={selectedCity}
          />
        </div>

        {/* Events Section */}
        {events.length > 0 && (
          <div className="mx-4 mt-4">
            <h2 className="text-lg font-bold mb-3">{t("events.upcoming") || "Eventi in arrivo"}</h2>
            <div className="space-y-4">
              {events.slice(0, 3).map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  partner={{
                    id: event.profiles?.id,
                    business_name: event.profiles?.business_name,
                    first_name: event.profiles?.first_name,
                    last_name: event.profiles?.last_name,
                    avatar_url: event.profiles?.profile_image_url,
                  }}
                  currentUserId={user.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Polls Feed (top) */}
        {polls.length > 0 && (
          <div className="mx-4 mt-4 space-y-4">
            {polls.map((poll) => (
              <PollCard key={poll.id} poll={poll} currentUserId={user.id} />
            ))}
          </div>
        )}

        {/* Posts Feed */}
        <div className="mx-4 mt-4 space-y-4">
          {loading ? (
            <SkeletonList count={3} Component={PostCardSkeleton} />
          ) : posts.length === 0 && events.length === 0 && polls.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-100">
              <p className="text-gray-600">Nessun post ancora. Sii il primo a postare!</p>
            </div>
          ) : (
            <>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUserId={user.id}
                  currentUserName={getDisplayName(profile)}
                  onDelete={handlePostDeleted}
                  onLikeToggle={handleLikeToggle}
                  city={selectedCity}
                />
              ))}
              {/* Infinite scroll sentinel */}
              <div ref={loadMoreRef} className="h-4" />
              {isFetchingNextPage && (
                <div className="flex justify-center py-4">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Settings Sheet */}
      <SettingsSheet
        open={settingsSheetOpen}
        onOpenChange={setSettingsSheetOpen}
      />

      {/* Account Switcher Sheet */}
      <AccountSwitcherSheet
        open={accountSwitcherOpen}
        onOpenChange={setAccountSwitcherOpen}
        currentProfile={profile ? { ...profile, email: user?.email } : null}
        onOpenSettings={() => setSettingsSheetOpen(true)}
      />

      {/* City Selector */}
      <CitySelector
        open={citySelectorOpen}
        onOpenChange={setCitySelectorOpen}
        selectedCity={selectedCity}
        onCityChange={handleCityChange}
        selectedCountry={selectedCountry}
        onCountryChange={handleCountryChange}
        isPartner={profile?.user_type === "partner"}
      />
    </div>
    </SwipeBackWrapper>
  );
};

export default Social;

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton specifici per le viste più frequenti — sostituiscono i
 * `<Loader2 animate-spin />` generici con il "ghost" della UI finale.
 * Riducono il jank e migliorano la velocità percepita: l'utente vede
 * subito la struttura e non un cerchio che gira.
 */

export const EventCardSkeleton = () => (
  <div className="overflow-hidden rounded-2xl border bg-card">
    <Skeleton className="aspect-video w-full rounded-none" />
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2.5 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>
    </div>
  </div>
);

export const PostCardSkeleton = () => (
  <div className="space-y-3 rounded-2xl border bg-card p-4">
    <div className="flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-2.5 w-1/5" />
      </div>
    </div>
    <Skeleton className="aspect-square w-full rounded-xl" />
    <div className="flex items-center gap-4">
      <Skeleton className="h-7 w-16 rounded-full" />
      <Skeleton className="h-7 w-16 rounded-full" />
      <Skeleton className="h-7 w-7 rounded-full" />
    </div>
  </div>
);

export const ChatListItemSkeleton = () => (
  <div className="flex items-center gap-3 px-4 py-3">
    <Skeleton className="h-12 w-12 flex-shrink-0 rounded-full" />
    <div className="flex-1 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-2.5 w-12" />
      </div>
      <Skeleton className="h-3 w-3/4" />
    </div>
  </div>
);

export const ParticipantSkeleton = () => (
  <div className="flex items-center gap-3 rounded-2xl border bg-card p-3">
    <Skeleton className="h-7 w-7 flex-shrink-0 rounded-full" />
    <Skeleton className="h-12 w-12 flex-shrink-0 rounded-full" />
    <div className="flex-1 space-y-1.5">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-2.5 w-1/3" />
    </div>
    <Skeleton className="h-6 w-16 rounded-full" />
  </div>
);

export const NotificationSkeleton = () => (
  <div className="flex items-start gap-3 px-4 py-3">
    <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
    <div className="flex-1 space-y-1.5">
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-2.5 w-1/4" />
    </div>
  </div>
);

export const SkeletonList = ({
  count = 3,
  Component,
}: {
  count?: number;
  Component: React.ComponentType;
}) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <Component key={i} />
    ))}
  </div>
);

import { motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Loader2, ArrowDown } from "lucide-react";
import { useState } from "react";
import { haptic } from "@/lib/haptics";

/**
 * Pull-to-refresh wrapper. Da avvolgere intorno a una lista scrollabile.
 * L'effetto si attiva solo se lo scroll è in cima (scrollTop === 0)
 * e l'utente trascina verso il basso oltre la soglia.
 *
 * Esempio:
 *   <PullToRefresh onRefresh={async () => await refetch()}>
 *     <FeedList />
 *   </PullToRefresh>
 */

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown>;
  children: React.ReactNode;
  threshold?: number;
}

const DEFAULT_THRESHOLD = 80;

export const PullToRefresh = ({
  onRefresh,
  children,
  threshold = DEFAULT_THRESHOLD,
}: PullToRefreshProps) => {
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);
  const y = useMotionValue(0);
  const indicatorOpacity = useTransform(y, [0, threshold], [0, 1]);
  const indicatorRotate = useTransform(y, [0, threshold], [0, 180]);

  const handleDragStart = () => {
    // Armiamo il drag solo se lo scroll è in cima — altrimenti
    // significa che l'utente sta scrollando la lista, non pullando.
    if (typeof window !== "undefined" && window.scrollY <= 0) {
      setArmed(true);
    }
  };

  const handleDragEnd = async (_: unknown, info: PanInfo) => {
    if (!armed) {
      y.set(0);
      return;
    }
    setArmed(false);

    if (info.offset.y > threshold) {
      haptic.medium();
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        y.set(0);
      }
    } else {
      y.set(0);
    }
  };

  return (
    <div className="relative">
      {/* Indicatore visibile durante il pull */}
      <motion.div
        style={{ opacity: indicatorOpacity }}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-3"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border">
          {refreshing ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <motion.div style={{ rotate: indicatorRotate }}>
              <ArrowDown className="h-5 w-5 text-primary" />
            </motion.div>
          )}
        </div>
      </motion.div>

      <motion.div
        style={{ y }}
        drag={refreshing ? false : "y"}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        dragMomentum={false}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {children}
      </motion.div>
    </div>
  );
};

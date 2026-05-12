import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AnimatedMarqueeHeroProps {
  tagline: string;
  title: React.ReactNode;
  description: string;
  ctaText: string;
  images: string[];
  onCtaClick?: () => void;
  className?: string;
}

const ActionButton = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) => (
  <motion.button
    type="button"
    onClick={onClick}
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
    className="mt-8 rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2"
  >
    {children}
  </motion.button>
);

export const AnimatedMarqueeHero: React.FC<AnimatedMarqueeHeroProps> = ({
  tagline,
  title,
  description,
  ctaText,
  images,
  onCtaClick,
  className,
}) => {
  const FADE_IN_ANIMATION_VARIANTS = {
    hidden: { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 100, damping: 20 },
    },
  };

  // Duplicate the image set so the marquee can loop seamlessly.
  const duplicatedImages = [...images, ...images];

  return (
    <section
      className={cn(
        // On mobile we let content + marquee stack vertically (auto
        // height) so the marquee never floats over the description.
        // On md+ we go back to a fixed-height hero with absolute
        // marquee at the bottom for a richer feel.
        "relative flex w-full flex-col items-center overflow-hidden bg-background px-4 pt-8 text-center md:h-[60vh] md:min-h-[420px] md:max-h-[640px] md:pt-12",
        className
      )}
    >
      <div className="z-10 flex flex-col items-center">
        <motion.div
          initial="hidden"
          animate="show"
          variants={FADE_IN_ANIMATION_VARIANTS}
          className="mb-4 inline-block rounded-full border border-border bg-card/50 px-4 py-1.5 text-sm font-medium text-muted-foreground backdrop-blur-sm"
        >
          {tagline}
        </motion.div>

        <motion.h1
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.1 } },
          }}
          className="text-5xl font-bold tracking-tighter text-foreground md:text-7xl"
        >
          {typeof title === "string"
            ? title.split(" ").map((word, i) => (
                <motion.span
                  key={i}
                  variants={FADE_IN_ANIMATION_VARIANTS}
                  className="inline-block"
                >
                  {word}&nbsp;
                </motion.span>
              ))
            : title}
        </motion.h1>

        <motion.p
          initial="hidden"
          animate="show"
          variants={FADE_IN_ANIMATION_VARIANTS}
          transition={{ delay: 0.5 }}
          className="mt-6 max-w-xl text-lg text-muted-foreground"
        >
          {description}
        </motion.p>

        <motion.div
          initial="hidden"
          animate="show"
          variants={FADE_IN_ANIMATION_VARIANTS}
          transition={{ delay: 0.6 }}
        >
          <ActionButton onClick={onCtaClick}>{ctaText}</ActionButton>
        </motion.div>
      </div>

      {/* Marquee — on mobile sits in normal flow below the content
          (auto height so it never overlaps the description). On md+
          floats absolutely at the bottom for the layered look. */}
      <div className="relative mt-8 h-44 w-full [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)] md:absolute md:bottom-0 md:left-0 md:mt-0 md:h-2/5">
        <motion.div
          className="flex gap-4"
          animate={{
            x: ["-100%", "0%"],
            transition: { ease: "linear", duration: 40, repeat: Infinity },
          }}
        >
          {duplicatedImages.map((src, index) => (
            <div
              key={index}
              className="relative aspect-[3/4] h-48 flex-shrink-0 md:h-64"
              style={{ rotate: `${index % 2 === 0 ? -2 : 5}deg` }}
            >
              <img
                src={src}
                alt=""
                aria-hidden="true"
                className="h-full w-full rounded-2xl object-cover shadow-md"
                loading="lazy"
              />
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default AnimatedMarqueeHero;

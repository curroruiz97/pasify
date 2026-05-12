"use client";

import { motion, useInView, Variants } from "framer-motion";
import { ElementType, RefObject } from "react";

interface TimelineContentProps {
  as?: ElementType;
  animationNum: number;
  timelineRef: RefObject<HTMLElement>;
  customVariants: Variants;
  className?: string;
  children?: React.ReactNode;
  once?: boolean;
  amount?: number;
  onClick?: () => void;
  [key: string]: unknown;
}

/**
 * Reveal element with staggered animation when the parent timelineRef enters
 * the viewport. Each TimelineContent uses `animationNum` as custom index for
 * the Variants callback (typically: delay proportional to index).
 */
export const TimelineContent = ({
  as,
  animationNum,
  timelineRef,
  customVariants,
  className,
  children,
  once = true,
  amount = 0.15,
  ...rest
}: TimelineContentProps) => {
  const isInView = useInView(timelineRef, { once, amount });
  const Tag = (as || "div") as ElementType;
  const MotionTag = motion(Tag as any);

  return (
    <MotionTag
      custom={animationNum}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={customVariants}
      className={className}
      {...rest}
    >
      {children}
    </MotionTag>
  );
};

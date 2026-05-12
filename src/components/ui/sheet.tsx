import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useDragControls, useMotionValue, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b p-6 data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        // Bottom sheet: stile standardizzato + supporto swipe-down (vedi SheetContent).
        // Non aggiungiamo p-6 qui: il padding lo gestiscono le pagine (pt-2 dopo l'handle, ecc.)
        bottom:
          "inset-x-0 bottom-0 border-t rounded-t-3xl shadow-2xl max-h-[90vh] sm:max-w-2xl sm:left-1/2 sm:-translate-x-1/2 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r p-6 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l p-6 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Hide the auto drag handle on bottom sheets. */
  hideDragHandle?: boolean;
}

// Soglie di chiusura per swipe-down sul bottom sheet
const SWIPE_CLOSE_THRESHOLD_PX = 120;
const SWIPE_CLOSE_VELOCITY = 500;

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, hideDragHandle, ...props }, ref) => {
    // Extract z-index from className to apply to overlay as well
    const hasHighZIndex = className?.includes('z-[200]');
    // Hide close button for bottom sheets (users can swipe down or tap outside)
    const isBottom = side === "bottom";
    const hideCloseButton = isBottom;

    // Hidden SheetClose: clic programmatico per chiudere via Radix
    const closeBtnRef = React.useRef<HTMLButtonElement>(null);
    const triggerClose = () => closeBtnRef.current?.click();

    // Drag controllato dalla handle: la lista interna resta scrollabile.
    const y = useMotionValue(0);
    const dragControls = useDragControls();
    const handleDragEnd = (_: unknown, info: PanInfo) => {
      if (info.offset.y > SWIPE_CLOSE_THRESHOLD_PX || info.velocity.y > SWIPE_CLOSE_VELOCITY) {
        haptic.tap();
        triggerClose();
      } else {
        y.set(0);
      }
    };

    if (isBottom) {
      return (
        <SheetPortal>
          <SheetOverlay className={hasHighZIndex ? "z-[199]" : undefined} />
          <SheetPrimitive.Content
            ref={ref}
            className={cn(sheetVariants({ side }), "p-0", className)}
            asChild
            {...props}
          >
            <motion.div
              style={{ y, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              dragMomentum={false}
              onDragEnd={handleDragEnd}
              className="flex flex-col"
            >
              <SheetPrimitive.Close ref={closeBtnRef} className="sr-only" tabIndex={-1} aria-hidden="true" />
              {!hideDragHandle && (
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  className="flex-shrink-0 flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing touch-none select-none"
                  aria-hidden="true"
                >
                  <div className="h-1.5 w-11 rounded-full bg-muted-foreground/30" />
                </div>
              )}
              {children}
            </motion.div>
          </SheetPrimitive.Content>
        </SheetPortal>
      );
    }

    return (
      <SheetPortal>
        <SheetOverlay className={hasHighZIndex ? "z-[199]" : undefined} />
        <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
          {children}
          {!hideCloseButton && (
            <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-secondary hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};

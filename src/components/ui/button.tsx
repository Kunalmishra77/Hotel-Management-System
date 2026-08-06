/**
 * Button — shadcn/ui (Radix Slot + CVA), per docs/architecture/ui-foundation.md.
 *
 * mobile-first.md: touch targets ≥ 44px. The default size is therefore
 * `min-h-touch`, not the shadcn default of 36px — a front-desk phone is the
 * primary device, not a mouse. `brand` = Concierge pine for brand surfaces.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-base font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:bg-primary/90",
        brand: "bg-brand-pine text-brand-pine-foreground shadow-card hover:bg-brand-pine/90",
        success: "bg-success text-success-foreground shadow-card hover:bg-success/90",
        destructive: "bg-destructive text-destructive-foreground shadow-card hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 44px floor — thumb-reachable primary actions.
        default: "min-h-touch px-4 py-2",
        sm: "min-h-touch px-3 text-sm",
        lg: "min-h-[52px] px-8 text-lg",
        icon: "min-h-touch min-w-touch",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "default", size: "default", block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, block, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

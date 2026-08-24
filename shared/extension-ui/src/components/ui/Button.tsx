// Registry lineage: https://21st.dev/community/components/originui/button
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/cn.js";

const buttonVariants = cva(
  "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 border text-sm font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,opacity,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary: "border-brass bg-brass px-4 text-iron hover:bg-brass-bright active:translate-y-px",
        outline: "border-line bg-transparent px-4 text-foreground hover:border-muted-foreground hover:bg-subtle",
        ghost: "border-transparent bg-transparent px-3 text-muted-foreground hover:bg-subtle hover:text-foreground",
        danger: "border-danger bg-danger px-4 text-white hover:bg-danger/90",
      },
      size: {
        default: "h-10",
        compact: "h-8 min-h-8 px-3 text-xs",
        icon: "h-10 w-10 min-w-10 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return <Component ref={ref} className={cn(buttonVariants({ size, variant }), className)} {...props} />;
  },
);
Button.displayName = "Button";

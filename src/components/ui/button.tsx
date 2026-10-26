import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-halo active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent-hover",
        secondary: "bg-subtle text-fg hover:bg-line dark:bg-surface-hover dark:hover:bg-line",
        outline: "border border-line bg-surface text-fg hover:bg-surface-hover",
        ghost: "text-fg hover:bg-subtle dark:hover:bg-surface-hover",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        sm: "h-8 rounded-sm px-3 text-[13px] [&_svg]:size-4",
        md: "h-9 rounded-md px-4 text-[14px] [&_svg]:size-4",
        lg: "h-11 rounded-md px-5 text-[15px] [&_svg]:size-5",
        xl: "h-14 w-full rounded-lg px-6 text-[17px] font-semibold [&_svg]:size-5",
        icon: "size-9 rounded-md [&_svg]:size-[18px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };

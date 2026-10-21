import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // `text-base` below sm, not `text-sm`: iOS Safari zooms the page whenever a focused
        // input is under 16px, which on a phone jerks the layout mid-form. A contractor
        // filling onboarding on site hits that on every field. 14px returns from sm up,
        // where no browser does this.
        "flex h-10 w-full min-w-0 rounded-md border border-brand-border-grey bg-white px-3 py-2 text-base sm:text-sm text-brand-near-black outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };

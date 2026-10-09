// Pill button from Beautiful UI (beautifului.dev, MIT). Use inside a `.bui` container.
import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const filledShadow = "shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-1.5 font-medium select-none transition-[transform,background-color,opacity] duration-150 ease-out active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				primary: `bg-ink text-canvas hover:opacity-90 ${filledShadow}`,
				secondary: "bg-surface text-ink shadow-btn hover:bg-inset",
				accent: `bg-accent text-white hover:bg-accent-ink ${filledShadow}`,
				quiet: "text-ink-2 hover:bg-hover hover:text-ink",
			},
			size: {
				xs: "h-7 rounded-full px-2.5 text-[12px]",
				sm: "h-[27px] rounded-full px-3 text-[12.5px]",
			},
		},
		defaultVariants: { variant: "secondary", size: "sm" },
	}
);

export function Button({
	variant,
	size,
	className,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
	return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

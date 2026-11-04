"use client";

// Night's icons (Phosphor, from designeer.xyz's catalogue), under the same names as icons.tsx. Swapped in at bundle time.
import type { Icon, IconWeight } from "@phosphor-icons/react";
import {
	ArrowsClockwise,
	CalendarDots,
	CaretDown,
	CaretRight,
	CaretUp,
	ChartLineUp,
	ChartPieSlice,
	Check,
	CheckCircle as PhCheckCircle,
	Circle,
	Copy as PhCopy,
	FileArrowDown,
	FunnelSimple,
	GearSix,
	House as PhHouse,
	Key,
	Plus as PhPlus,
	Receipt as PhReceipt,
	SidebarSimple,
	SignOut,
	Sparkle,
	TrendUp,
	UploadSimple,
	WarningCircle,
	X,
} from "@phosphor-icons/react";
import type { LucideIcon, LucideProps } from "lucide-react";

export type { LucideIcon };

// Same default size as Lucide, so an unsized icon lays out alike; existing size-* classes win over it.
const ph = (Glyph: Icon, weight: IconWeight = "regular") =>
	function NightIcon({ strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, ...props }: LucideProps) {
		const rest = props as object;
		return <Glyph weight={weight} size={24} {...rest} />;
	} as unknown as LucideIcon;

export const AlertCircle = ph(WarningCircle);
export const CalendarClock = ph(CalendarDots);
export const ChartLine = ph(ChartLineUp);
export const CheckCircle = ph(PhCheckCircle);
export const CheckIcon = ph(Check);
export const ChevronDownIcon = ph(CaretDown);
export const ChevronRightIcon = ph(CaretRight);
export const ChevronUpIcon = ph(CaretUp);
export const CircleIcon = ph(Circle, "fill");
export const Copy = ph(PhCopy);
export const FileDown = ph(FileArrowDown);
export const Filter = ph(FunnelSimple);
export const House = ph(PhHouse);
export const KeyRound = ph(Key);
export const LogOut = ph(SignOut);
export const PanelLeftIcon = ph(SidebarSimple);
export const PieChart = ph(ChartPieSlice);
export const Plus = ph(PhPlus);
export const Receipt = ph(PhReceipt);
export const ReceiptText = ph(PhReceipt);
export const RefreshCw = ph(ArrowsClockwise);
export const Settings = ph(GearSix);
export const Sparkles = ph(Sparkle);
export const TrendingUp = ph(TrendUp);
export const Upload = ph(UploadSimple);
export const XIcon = ph(X);

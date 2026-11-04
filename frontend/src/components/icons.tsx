"use client";

// The app's icons, under their Lucide names so moving a file over is one changed import. The Night build (see
// lib/app-theme.ts) draws Phosphor; Sky keeps Lucide. NIGHT is a build-time constant, so a Sky build drops the Phosphor
// side. Files not yet moved still import lucide-react directly.
import type { ComponentType } from "react";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
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
import {
	AlertCircle as LAlertCircle,
	CalendarClock as LCalendarClock,
	ChartLine as LChartLine,
	CheckCircle as LCheckCircle,
	CheckIcon as LCheckIcon,
	ChevronDownIcon as LChevronDownIcon,
	ChevronRightIcon as LChevronRightIcon,
	ChevronUpIcon as LChevronUpIcon,
	CircleIcon as LCircleIcon,
	Copy as LCopy,
	FileDown as LFileDown,
	Filter as LFilter,
	House as LHouse,
	KeyRound as LKeyRound,
	LogOut as LLogOut,
	PanelLeftIcon as LPanelLeftIcon,
	PieChart as LPieChart,
	Plus as LPlus,
	Receipt as LReceipt,
	ReceiptText as LReceiptText,
	RefreshCw as LRefreshCw,
	Settings as LSettings,
	Sparkles as LSparkles,
	TrendingUp as LTrendingUp,
	Upload as LUpload,
	XIcon as LXIcon,
	type LucideProps,
} from "lucide-react";

export type LucideIcon = ComponentType<LucideProps>;

const NIGHT = process.env.NEXT_PUBLIC_APP_THEME === "night";

// Same default size as Lucide, so an unsized icon lays out alike; existing size-* classes win over it.
const ph = (Glyph: PhosphorIcon, weight: IconWeight = "regular"): LucideIcon =>
	function NightIcon({ strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, ...props }: LucideProps) {
		const rest = props as object;
		return <Glyph weight={weight} size={24} {...rest} />;
	};

export const AlertCircle: LucideIcon = NIGHT ? ph(WarningCircle) : LAlertCircle;
export const CalendarClock: LucideIcon = NIGHT ? ph(CalendarDots) : LCalendarClock;
export const ChartLine: LucideIcon = NIGHT ? ph(ChartLineUp) : LChartLine;
export const CheckCircle: LucideIcon = NIGHT ? ph(PhCheckCircle) : LCheckCircle;
export const CheckIcon: LucideIcon = NIGHT ? ph(Check) : LCheckIcon;
export const ChevronDownIcon: LucideIcon = NIGHT ? ph(CaretDown) : LChevronDownIcon;
export const ChevronRightIcon: LucideIcon = NIGHT ? ph(CaretRight) : LChevronRightIcon;
export const ChevronUpIcon: LucideIcon = NIGHT ? ph(CaretUp) : LChevronUpIcon;
export const CircleIcon: LucideIcon = NIGHT ? ph(Circle, "fill") : LCircleIcon;
export const Copy: LucideIcon = NIGHT ? ph(PhCopy) : LCopy;
export const FileDown: LucideIcon = NIGHT ? ph(FileArrowDown) : LFileDown;
export const Filter: LucideIcon = NIGHT ? ph(FunnelSimple) : LFilter;
export const House: LucideIcon = NIGHT ? ph(PhHouse) : LHouse;
export const KeyRound: LucideIcon = NIGHT ? ph(Key) : LKeyRound;
export const LogOut: LucideIcon = NIGHT ? ph(SignOut) : LLogOut;
export const PanelLeftIcon: LucideIcon = NIGHT ? ph(SidebarSimple) : LPanelLeftIcon;
export const PieChart: LucideIcon = NIGHT ? ph(ChartPieSlice) : LPieChart;
export const Plus: LucideIcon = NIGHT ? ph(PhPlus) : LPlus;
export const Receipt: LucideIcon = NIGHT ? ph(PhReceipt) : LReceipt;
export const ReceiptText: LucideIcon = NIGHT ? ph(PhReceipt) : LReceiptText;
export const RefreshCw: LucideIcon = NIGHT ? ph(ArrowsClockwise) : LRefreshCw;
export const Settings: LucideIcon = NIGHT ? ph(GearSix) : LSettings;
export const Sparkles: LucideIcon = NIGHT ? ph(Sparkle) : LSparkles;
export const TrendingUp: LucideIcon = NIGHT ? ph(TrendUp) : LTrendingUp;
export const Upload: LucideIcon = NIGHT ? ph(UploadSimple) : LUpload;
export const XIcon: LucideIcon = NIGHT ? ph(X) : LXIcon;

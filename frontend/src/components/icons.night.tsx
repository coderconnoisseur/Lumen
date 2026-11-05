"use client";

// Night's icons (Phosphor, from designeer.xyz's catalogue), under the same names as icons.tsx. Swapped in at bundle time.
import type { Icon, IconWeight } from "@phosphor-icons/react";
import {
	ArrowCounterClockwise as PhArrowCounterClockwise,
	ArrowRight as PhArrowRight,
	ArrowUp as PhArrowUp,
	ArrowUpRight as PhArrowUpRight,
	ArrowsClockwise as PhArrowsClockwise,
	CalendarDots as PhCalendarDots,
	Camera as PhCamera,
	CaretDown as PhCaretDown,
	CaretLeft as PhCaretLeft,
	CaretRight as PhCaretRight,
	CaretUp as PhCaretUp,
	ChartLineUp as PhChartLineUp,
	ChartPieSlice as PhChartPieSlice,
	Check as PhCheck,
	CheckCircle as PhCheckCircle,
	Circle as PhCircle,
	CircleNotch as PhCircleNotch,
	ClockCounterClockwise as PhClockCounterClockwise,
	Copy as PhCopy,
	CreditCard as PhCreditCard,
	DotsThree as PhDotsThree,
	DownloadSimple as PhDownloadSimple,
	EnvelopeSimple as PhEnvelopeSimple,
	Eye as PhEye,
	EyeSlash as PhEyeSlash,
	FileArrowDown as PhFileArrowDown,
	FileCsv as PhFileCsv,
	FileText as PhFileText,
	FloppyDisk as PhFloppyDisk,
	FunnelSimple as PhFunnelSimple,
	GearSix as PhGearSix,
	GlobeSimple as PhGlobeSimple,
	House as PhHouse,
	Info as PhInfo,
	Key as PhKey,
	List as PhList,
	Lock as PhLock,
	MagnifyingGlass as PhMagnifyingGlass,
	Microphone as PhMicrophone,
	NotePencil as PhNotePencil,
	Paperclip as PhPaperclip,
	Pause as PhPause,
	PencilSimple as PhPencilSimple,
	Play as PhPlay,
	Plus as PhPlus,
	Quotes as PhQuotes,
	Receipt as PhReceipt,
	SealCheck as PhSealCheck,
	ShieldCheck as PhShieldCheck,
	ShieldWarning as PhShieldWarning,
	SidebarSimple as PhSidebarSimple,
	SignOut as PhSignOut,
	Sparkle as PhSparkle,
	ThumbsDown as PhThumbsDown,
	ThumbsUp as PhThumbsUp,
	Trash as PhTrash,
	TrendDown as PhTrendDown,
	TrendUp as PhTrendUp,
	UploadSimple as PhUploadSimple,
	UserCheck as PhUserCheck,
	WarningCircle as PhWarningCircle,
	X as PhX,
	XCircle as PhXCircle,
} from "@phosphor-icons/react";
import type { LucideIcon, LucideProps } from "lucide-react";

export type { LucideIcon };

// Same default size as Lucide, so an unsized icon lays out alike; existing size-* classes win over it. A `fill` colour
// (the mockups' sparkle) means the solid version of the glyph.
const ph = (Glyph: Icon, weight: IconWeight = "regular") =>
	function NightIcon({ strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, ...props }: LucideProps) {
		const rest = props as object;
		return <Glyph weight={props.fill && props.fill !== "none" ? "fill" : weight} size={24} {...rest} />;
	} as unknown as LucideIcon;

export const AlertCircle = ph(PhWarningCircle);
export const ArrowRight = ph(PhArrowRight);
export const ArrowUp = ph(PhArrowUp);
export const ArrowUpRight = ph(PhArrowUpRight);
export const CalendarClock = ph(PhCalendarDots);
export const Camera = ph(PhCamera);
export const ChartLine = ph(PhChartLineUp);
export const Check = ph(PhCheck);
export const CheckCircle = ph(PhCheckCircle);
export const CheckCircle2 = ph(PhCheckCircle);
export const CheckIcon = ph(PhCheck);
export const ChevronDown = ph(PhCaretDown);
export const ChevronDownIcon = ph(PhCaretDown);
export const ChevronLeft = ph(PhCaretLeft);
export const ChevronRight = ph(PhCaretRight);
export const ChevronRightIcon = ph(PhCaretRight);
export const ChevronUpIcon = ph(PhCaretUp);
export const CircleIcon = ph(PhCircle, "fill");
export const Copy = ph(PhCopy);
export const CreditCard = ph(PhCreditCard);
export const Download = ph(PhDownloadSimple);
export const Eye = ph(PhEye);
export const EyeOff = ph(PhEyeSlash);
export const FileCheck2 = ph(PhSealCheck);
export const FileDown = ph(PhFileArrowDown);
export const FileSpreadsheet = ph(PhFileCsv);
export const FileText = ph(PhFileText);
export const Filter = ph(PhFunnelSimple);
export const Globe = ph(PhGlobeSimple);
export const History = ph(PhClockCounterClockwise);
export const Home = ph(PhHouse);
export const House = ph(PhHouse);
export const Info = ph(PhInfo);
export const KeyRound = ph(PhKey);
export const Loader2 = ph(PhCircleNotch);
export const Lock = ph(PhLock);
export const LogOut = ph(PhSignOut);
export const Mail = ph(PhEnvelopeSimple);
export const Menu = ph(PhList);
export const Mic = ph(PhMicrophone);
export const MoreHorizontal = ph(PhDotsThree);
export const PanelLeftIcon = ph(PhSidebarSimple);
export const Paperclip = ph(PhPaperclip);
export const Pause = ph(PhPause);
export const Pencil = ph(PhPencilSimple);
export const PieChart = ph(PhChartPieSlice);
export const Play = ph(PhPlay);
export const Plus = ph(PhPlus);
export const Quote = ph(PhQuotes);
export const Receipt = ph(PhReceipt);
export const ReceiptText = ph(PhReceipt);
export const RefreshCw = ph(PhArrowsClockwise);
export const RotateCcw = ph(PhArrowCounterClockwise);
export const Save = ph(PhFloppyDisk);
export const Search = ph(PhMagnifyingGlass);
export const Settings = ph(PhGearSix);
export const ShieldAlert = ph(PhShieldWarning);
export const ShieldCheck = ph(PhShieldCheck);
export const Sparkles = ph(PhSparkle);
export const SquarePen = ph(PhNotePencil);
export const ThumbsDown = ph(PhThumbsDown);
export const ThumbsUp = ph(PhThumbsUp);
export const Trash2 = ph(PhTrash);
export const TrendingDown = ph(PhTrendDown);
export const TrendingUp = ph(PhTrendUp);
export const Upload = ph(PhUploadSimple);
export const UserCheck = ph(PhUserCheck);
export const X = ph(PhX);
export const XCircle = ph(PhXCircle);
export const XIcon = ph(PhX);

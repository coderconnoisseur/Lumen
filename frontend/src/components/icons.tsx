"use client";

// The app's icons: Lucide in Sky, Phosphor in Night, picked by the theme the user chose (components/app-theme.tsx).
// Import icons from here, not from lucide-react or Phosphor. Outside the signed-in app (landing, login) it's always Sky.
import type { LucideIcon, LucideProps } from "lucide-react";
import { useAppTheme } from "./app-theme";
import * as Night from "./icons.night";
import * as Sky from "./icons.sky";

export type { LucideIcon };

const both = (SkyIcon: LucideIcon, NightIcon: LucideIcon) =>
	function ThemedIcon(props: LucideProps) {
		const Icon = useAppTheme().theme === "night" ? NightIcon : SkyIcon;
		return <Icon {...props} />;
	} as unknown as LucideIcon;

export const AlertCircle = both(Sky.AlertCircle, Night.AlertCircle);
export const ArrowRight = both(Sky.ArrowRight, Night.ArrowRight);
export const ArrowUp = both(Sky.ArrowUp, Night.ArrowUp);
export const ArrowUpRight = both(Sky.ArrowUpRight, Night.ArrowUpRight);
export const CalendarClock = both(Sky.CalendarClock, Night.CalendarClock);
export const Camera = both(Sky.Camera, Night.Camera);
export const ChartLine = both(Sky.ChartLine, Night.ChartLine);
export const Check = both(Sky.Check, Night.Check);
export const CheckCircle = both(Sky.CheckCircle, Night.CheckCircle);
export const CheckCircle2 = both(Sky.CheckCircle2, Night.CheckCircle2);
export const CheckIcon = both(Sky.CheckIcon, Night.CheckIcon);
export const ChevronDown = both(Sky.ChevronDown, Night.ChevronDown);
export const ChevronDownIcon = both(Sky.ChevronDownIcon, Night.ChevronDownIcon);
export const ChevronLeft = both(Sky.ChevronLeft, Night.ChevronLeft);
export const ChevronRight = both(Sky.ChevronRight, Night.ChevronRight);
export const ChevronRightIcon = both(Sky.ChevronRightIcon, Night.ChevronRightIcon);
export const ChevronUpIcon = both(Sky.ChevronUpIcon, Night.ChevronUpIcon);
export const CircleIcon = both(Sky.CircleIcon, Night.CircleIcon);
export const Copy = both(Sky.Copy, Night.Copy);
export const CreditCard = both(Sky.CreditCard, Night.CreditCard);
export const Download = both(Sky.Download, Night.Download);
export const Eye = both(Sky.Eye, Night.Eye);
export const EyeOff = both(Sky.EyeOff, Night.EyeOff);
export const FileCheck2 = both(Sky.FileCheck2, Night.FileCheck2);
export const FileDown = both(Sky.FileDown, Night.FileDown);
export const FileSpreadsheet = both(Sky.FileSpreadsheet, Night.FileSpreadsheet);
export const FileText = both(Sky.FileText, Night.FileText);
export const Filter = both(Sky.Filter, Night.Filter);
export const Globe = both(Sky.Globe, Night.Globe);
export const History = both(Sky.History, Night.History);
export const Home = both(Sky.Home, Night.Home);
export const House = both(Sky.House, Night.House);
export const Info = both(Sky.Info, Night.Info);
export const KeyRound = both(Sky.KeyRound, Night.KeyRound);
export const Loader2 = both(Sky.Loader2, Night.Loader2);
export const Lock = both(Sky.Lock, Night.Lock);
export const LogOut = both(Sky.LogOut, Night.LogOut);
export const Mail = both(Sky.Mail, Night.Mail);
export const Menu = both(Sky.Menu, Night.Menu);
export const Mic = both(Sky.Mic, Night.Mic);
export const Moon = both(Sky.Moon, Night.Moon);
export const MoreHorizontal = both(Sky.MoreHorizontal, Night.MoreHorizontal);
export const PanelLeftIcon = both(Sky.PanelLeftIcon, Night.PanelLeftIcon);
export const Paperclip = both(Sky.Paperclip, Night.Paperclip);
export const Pause = both(Sky.Pause, Night.Pause);
export const Pencil = both(Sky.Pencil, Night.Pencil);
export const PieChart = both(Sky.PieChart, Night.PieChart);
export const Play = both(Sky.Play, Night.Play);
export const Plus = both(Sky.Plus, Night.Plus);
export const Quote = both(Sky.Quote, Night.Quote);
export const Receipt = both(Sky.Receipt, Night.Receipt);
export const ReceiptText = both(Sky.ReceiptText, Night.ReceiptText);
export const RefreshCw = both(Sky.RefreshCw, Night.RefreshCw);
export const RotateCcw = both(Sky.RotateCcw, Night.RotateCcw);
export const Save = both(Sky.Save, Night.Save);
export const Search = both(Sky.Search, Night.Search);
export const Settings = both(Sky.Settings, Night.Settings);
export const ShieldAlert = both(Sky.ShieldAlert, Night.ShieldAlert);
export const ShieldCheck = both(Sky.ShieldCheck, Night.ShieldCheck);
export const Sparkles = both(Sky.Sparkles, Night.Sparkles);
export const SquarePen = both(Sky.SquarePen, Night.SquarePen);
export const ThumbsDown = both(Sky.ThumbsDown, Night.ThumbsDown);
export const ThumbsUp = both(Sky.ThumbsUp, Night.ThumbsUp);
export const Trash2 = both(Sky.Trash2, Night.Trash2);
export const TrendingDown = both(Sky.TrendingDown, Night.TrendingDown);
export const TrendingUp = both(Sky.TrendingUp, Night.TrendingUp);
export const Upload = both(Sky.Upload, Night.Upload);
export const UserCheck = both(Sky.UserCheck, Night.UserCheck);
export const X = both(Sky.X, Night.X);
export const XCircle = both(Sky.XCircle, Night.XCircle);
export const XIcon = both(Sky.XIcon, Night.XIcon);

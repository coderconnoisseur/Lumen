"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DialogTitle } from "@radix-ui/react-dialog";
import Link from "next/link";
import { documentsApi, ocrApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { eventBus, EVENTS } from "@/lib/events";

import { logger } from "@/lib/logger";
interface FileWithStatus {
	file: File;
	status: "pending" | "uploading" | "success" | "error";
	error?: string;
	note?: string;
	extractedData?: any;
}

const DOC_TYPES = [
	{ value: "contract", label: "Contract" },
	{ value: "policy", label: "Policy" },
	{ value: "purchase_order", label: "Purchase order" },
	{ value: "invoice", label: "Invoice" },
	{ value: "other", label: "Other" },
];

// Pass `open`/`onOpenChange` to open it from elsewhere too (Home's hero +); otherwise it manages itself.
// Receipts & invoices are read into transactions (/extract); Documents (PDF contracts, policies…) are indexed for
// Ask Lumen's document search (/api/documents). Statements have their own import.
export function DialogDemo({
	defaultOpen = false,
	open: openProp,
	onOpenChange,
}: {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const [files, setFiles] = useState<FileWithStatus[]>([]);
	const [uploading, setUploading] = useState(false);
	const [kind, setKind] = useState<"receipts" | "documents">("receipts");
	const [docType, setDocType] = useState("contract");
	const [ownOpen, setOwnOpen] = useState(defaultOpen);
	const open = openProp ?? ownOpen;
	const setOpen = (next: boolean) => {
		setOwnOpen(next);
		onOpenChange?.(next);
	};

	useEffect(() => {
		if (defaultOpen) {
			setOwnOpen(true);
		}
	}, [defaultOpen]);

	const onFiles = useCallback((selected: FileList | null) => {
		if (!selected) return;
		const newFiles = Array.from(selected).map((file) => ({
			file,
			status: "pending" as const,
		}));
		setFiles((prev) => [...prev, ...newFiles]);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			onFiles(e.dataTransfer.files);
		},
		[onFiles]
	);

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onFiles(e.target.files);
		e.currentTarget.value = ""; // reset
	};

	const removeFile = (idx: number) =>
		setFiles((prev) => prev.filter((_, i) => i !== idx));

	const handleUpload = async () => {
		if (files.length === 0) return;

		setUploading(true);

		for (let i = 0; i < files.length; i++) {
			const fileItem = files[i];

			if (fileItem.status !== "pending") continue;

			// Update status to uploading
			setFiles((prev) => {
				const updated = [...prev];
				updated[i] = { ...updated[i], status: "uploading" };
				return updated;
			});

			try {
				logger.debug("📤 Uploading file:", fileItem.file.name);
				// Use OCR API to extract data - this saves to database automatically
				const result =
					kind === "documents"
						? { success: true, data: await documentsApi.upload(fileItem.file, docType), duplicate: false }
						: await ocrApi.extractInvoice(fileItem.file);

				logger.debug("📥 OCR API Response:", result);

				if (result.success && result.data) {
					logger.debug(
						"✅ Invoice extracted and saved to database:",
						result.data
					);
					logger.debug("📢 Emitting INVOICE_UPDATED event...");

					// Emit event to trigger refresh in other components
					eventBus.emit(EVENTS.INVOICE_UPDATED);

					logger.debug("✅ Event emitted successfully");
				} else {
					console.warn(
						"⚠️ Upload succeeded but no data or success=false",
						result
					);
				}

				// Update status to success
				setFiles((prev) => {
					const updated = [...prev];
					updated[i] = {
						...updated[i],
						status: "success",
						note: result.duplicate ? "Already uploaded" : undefined,
						extractedData: result.data,
					};
					return updated;
				});
			} catch (error) {
				console.error("Upload error:", error);

				// Prefer the backend's user-facing message; axios's own message is
				// just "Request failed with status code 503".
				const serverMessage: string | undefined = (error as any)?.response
					?.data?.error;
				const errorMessage =
					serverMessage ??
					(error instanceof Error ? error.message : "Upload failed");

				// Update status to error
				setFiles((prev) => {
					const updated = [...prev];
					updated[i] = {
						...updated[i],
						status: "error",
						error: errorMessage,
					};
					return updated;
				});
			}
		}

		setUploading(false);

		setFiles((current) => {
			const allSuccess =
				current.length > 0 &&
				current.every((f) => f.status === "success");
			if (allSuccess) {
				setTimeout(() => {
					setOpen(false);
					setFiles([]);
					eventBus.emit(EVENTS.INVOICE_UPDATED);
				}, 1500);
			}
			return current;
		});
	};

	const getStatusIcon = (status: FileWithStatus["status"]) => {
		switch (status) {
			case "uploading":
				return (
					<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
				);
			case "success":
				return <CheckCircle className="w-4 h-4 text-good" />;
			case "error":
				return <AlertCircle className="w-4 h-4 text-bad" />;
			default:
				return null;
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="quiet">
					<Upload />
					Upload
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl bg-card border-border">
				<DialogTitle className="sr-only">Upload</DialogTitle>
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-xl bg-muted">
							<Upload className="w-5 h-5 text-muted-foreground" />
						</div>
						<div>
							<h3 className="text-foreground text-2xl font-semibold">
								Upload
							</h3>
							<p className="text-sm text-muted-foreground mt-1">
								{kind === "receipts"
									? "Lumen reads each one into a transaction. PDF, PNG or JPG."
									: "Contracts, policies and other PDFs, searchable from Ask Lumen."}
							</p>
						</div>
					</div>

				</div>

				<div className="mt-5 flex flex-wrap items-center gap-3">
					<div role="radiogroup" aria-label="What are you uploading?" className="flex gap-0.5 rounded-[9px] border border-border/60 bg-muted/40 p-0.5">
						{([["receipts", "Receipts & invoices"], ["documents", "Documents"]] as const).map(([value, label]) => (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={kind === value}
								disabled={uploading}
								onClick={() => setKind(value)}
								className={cn("label-ui rounded-[7px] px-3 py-1", kind === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
							>
								{label}
							</button>
						))}
					</div>
					{kind === "documents" && (
						<label className="flex items-center gap-2 text-sm text-muted-foreground">
							Type
							<select value={docType} onChange={(e) => setDocType(e.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-foreground">
								{DOC_TYPES.map((t) => (
									<option key={t.value} value={t.value}>{t.label}</option>
								))}
							</select>
						</label>
					)}
				</div>
				<p className="mt-2 text-[12.5px] text-muted-foreground">
					Statements are CSV files:{" "}
					<Link href="/receipts/import" onClick={() => setOpen(false)} className="text-foreground underline underline-offset-4">
						import a statement
					</Link>{" "}
					instead.
				</p>

				<div
					onDragOver={(e) => e.preventDefault()}
					onDrop={handleDrop}
					className="mt-4 rounded-xl border-2 border-dashed border-border p-6 flex flex-col items-center justify-center text-center bg-transparent"
				>
					<input
						id="file-input-dashboard"
						type="file"
						multiple
						accept={kind === "documents" ? ".pdf" : ".pdf,.png,.jpg,.jpeg"}
						onChange={handleFileChange}
						className="hidden"
					/>
					<label
						htmlFor="file-input-dashboard"
						className="cursor-pointer w-full"
					>
						<div className="text-foreground text-lg font-medium mb-2">
							Drop files here
						</div>
						<div className="text-muted-foreground mb-4">
							or click to select files
						</div>
						<div className="flex gap-3 justify-center">
							<Button asChild type="button" variant="quiet">
								<span className="px-4 py-2">Browse</span>
							</Button>
							<Button
								variant="ink"
								onClick={handleUpload}
								disabled={uploading || files.length === 0}
								type="button"
							>
								{uploading ? "Uploading..." : "Upload"}
							</Button>
						</div>
					</label>
				</div>

				<div className="mt-6">
					<h4 className="text-foreground text-sm font-medium mb-2">
						Files
					</h4>
					<div className="flex flex-col gap-2 max-h-48 overflow-auto">
						{files.length === 0 && (
							<div className="text-muted-foreground text-sm">
								No files selected
							</div>
						)}
						{files.map((fileItem, i) => (
							<div
								key={i}
								className="flex items-center justify-between gap-4 bg-muted/50 p-2 rounded-md"
							>
								<div className="flex items-center gap-2 flex-1 min-w-0">
									{getStatusIcon(fileItem.status)}
									<div className="truncate text-sm text-foreground">
										{fileItem.file.name}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<div className="text-xs text-muted-foreground">
										{(fileItem.file.size / 1024).toFixed(1)}{" "}
										KB
									</div>
									{fileItem.status === "error" &&
										fileItem.error && (
											<div
												className="text-xs text-bad max-w-[150px] truncate"
												title={fileItem.error}
											>
												{fileItem.error}
											</div>
										)}
									{fileItem.note && (
										<div className="text-xs text-muted-foreground">
											{fileItem.note}
										</div>
									)}
									<Button
										variant="ghost"
										size="sm"
										onClick={() => removeFile(i)}
										disabled={
											fileItem.status === "uploading"
										}
									>
										Remove
									</Button>
								</div>
							</div>
						))}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

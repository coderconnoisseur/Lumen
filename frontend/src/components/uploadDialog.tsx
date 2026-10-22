"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DialogTitle } from "@radix-ui/react-dialog";
import { ocrApi } from "@/lib/api/client";
import { eventBus, EVENTS } from "@/lib/events";

import { logger } from "@/lib/logger";
interface FileWithStatus {
	file: File;
	status: "pending" | "uploading" | "success" | "error";
	error?: string;
	note?: string;
	extractedData?: any;
}

// Pass `open`/`onOpenChange` to open it from elsewhere too (Home's hero +); otherwise it manages itself.
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
				const result = await ocrApi.extractInvoice(fileItem.file);

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
				<DialogTitle className="sr-only">Upload documents</DialogTitle>
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-xl bg-muted">
							<Upload className="w-5 h-5 text-muted-foreground" />
						</div>
						<div>
							<h3 className="text-foreground text-2xl font-semibold">
								Upload documents
							</h3>
							<p className="text-sm text-muted-foreground mt-1">
								Drag & drop files here or click to browse.
								Supported: PDF, PNG, JPG
							</p>
						</div>
					</div>

				</div>

				<div
					onDragOver={(e) => e.preventDefault()}
					onDrop={handleDrop}
					className="mt-6 rounded-xl border-2 border-dashed border-border p-6 flex flex-col items-center justify-center text-center bg-transparent"
				>
					<input
						id="file-input-dashboard"
						type="file"
						multiple
						accept=".pdf,.png,.jpg,.jpeg"
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

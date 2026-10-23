"use client";

// Settings: the user's own model keys (SPEC-BYOK). Bare-bones on purpose; the inner-app revamp restyles it.
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { keysApi, type ProviderKey } from "@/lib/api/client";
import { toast } from "@/lib/toast";

const ROLES: [string, string][] = [
	["agent", "Ask Lumen"],
	["text", "Email"],
	["vision", "Invoices"],
];

function apiError(error: unknown, fallback: string): string {
	const r = (error as { response?: { status?: number; data?: { error?: string; detail?: string } } })?.response;
	if (r?.status === 429) return "Too many tries. Wait a minute and try again.";
	return r?.data?.error ?? r?.data?.detail ?? fallback;
}

function status(k: NonNullable<ProviderKey["key"]>): string {
	if (k.last_error) return k.last_error;
	return k.last_ok_at ? `works · checked ${new Date(k.last_ok_at + "Z").toLocaleString()}` : "saved";
}

function KeyRow({ p, onChange }: { p: ProviderKey; onChange: () => void }) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	const [picks, setPicks] = useState<Record<string, string>>(p.key?.models ?? {});
	const saved = p.key;

	async function save() {
		setBusy(true);
		try {
			const chosen = Object.fromEntries(Object.entries(picks).filter(([, m]) => m));
			await keysApi.save(p.provider, value, Object.keys(chosen).length ? chosen : undefined);
			setValue("");
			setEditing(false);
			toast.success(`${p.name} key saved.`);
			onChange();
		} catch (e) {
			toast.error(apiError(e, "Couldn't save the key."));
		} finally {
			setBusy(false);
		}
	}

	async function run(fn: () => Promise<string | void>, fallback: string) {
		setBusy(true);
		try {
			const msg = await fn();
			if (msg) toast.info(msg);
		} catch (e) {
			toast.error(apiError(e, fallback));
		} finally {
			setBusy(false);
			onChange();
		}
	}

	const hasModels = Object.keys(p.models).length > 0;
	return (
		<Card className="gap-2 p-4">
			{/* fixed height so status text changes never move the rows below */}
			<div className="flex h-9 items-center gap-3">
				<span className="w-24 shrink-0 font-medium">{p.name}</span>
				<span
					className={`min-w-0 flex-1 truncate text-sm ${saved?.last_error ? "text-destructive" : "text-muted-foreground"}`}
					title={saved ? status(saved) : undefined}
				>
					{saved ? `•••• ${saved.last4} · ${status(saved)}` : "No key"}
				</span>
				{editing ? (
					<form
						className="flex items-center gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							void save();
						}}
					>
						<Input
							type="password"
							autoComplete="off"
							placeholder="Paste key"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							className="w-56"
							aria-label={`${p.name} key`}
						/>
						<Button type="submit" size="sm" disabled={busy || value.length < 8}>
							Save
						</Button>
						<Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(""); }}>
							Cancel
						</Button>
					</form>
				) : (
					<>
						<Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
							{saved ? "Replace" : "Add key"}
						</Button>
						{saved && (
							<>
								<Button
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											const r = await keysApi.test(p.provider);
											return r.success ? `${p.name} key works.` : r.message;
										}, "Couldn't test the key.")
									}
								>
									Test
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() => void run(() => keysApi.remove(p.provider), "Couldn't remove the key.")}
								>
									Remove
								</Button>
							</>
						)}
					</>
				)}
			</div>
			{p.provider === "tavily" && (
				<p className="text-xs text-muted-foreground">
					Web search for Ask Lumen. Without your key, a small daily allowance on Lumen&apos;s key.
				</p>
			)}
			{saved && hasModels && (
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">Advanced</summary>
					<div className="mt-2 flex flex-wrap items-center gap-3">
						{ROLES.map(([role, label]) => (
							<label key={role} className="flex items-center gap-2">
								{label}
								<select
									className="h-8 rounded-md border border-input bg-transparent px-2"
									value={picks[role] ?? ""}
									onChange={(e) => setPicks({ ...picks, [role]: e.target.value })}
								>
									<option value="">Default</option>
									{(p.models[role] ?? []).map((m) => (
										<option key={m} value={m}>
											{m}
										</option>
									))}
								</select>
							</label>
						))}
					</div>
					<p className="mt-2 text-xs text-muted-foreground">Model choices are saved with the key: pick, then Replace.</p>
				</details>
			)}
		</Card>
	);
}

export default function SettingsContent() {
	const [data, setData] = useState<Awaited<ReturnType<typeof keysApi.list>> | null>(null);

	const load = useCallback(() => {
		keysApi.list().then(setData).catch((e) => toast.error(apiError(e, "Couldn't load your keys.")));
	}, []);
	useEffect(load, [load]);

	return (
		<div className="px-4 py-6 sm:px-6 lg:px-8">
			<PageHeader
				title="Settings"
				brief={<p className="font-serif text-[19px] leading-[1.45] text-foreground/80">Add your own model keys. Without one, Lumen&apos;s free allowance applies.</p>}
			/>
			<div id="keys" className="flex max-w-3xl flex-col gap-3">
				{data?.providers?.map((p) => (
					<KeyRow key={p.provider} p={p} onChange={load} />
				))}
				{data && (
					<p className="text-sm text-muted-foreground">
						Models in use:{" "}
						{ROLES.map(([role, label]) => `${label} → ${!data.in_use?.[role] || data.in_use[role] === "platform" ? "Lumen's free allowance" : data.in_use[role]}`).join(" · ")}
					</p>
				)}
			</div>
		</div>
	);
}

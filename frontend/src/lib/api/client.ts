import axios, { AxiosInstance, AxiosError } from "axios";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
if (!API_BASE_URL) {
	throw new Error(
		"NEXT_PUBLIC_BACKEND_URL is not set. See frontend/.env.example."
	);
}

/** Wake the API (Render's free plan sleeps when idle) while the user is still reading or signing in. */
export const warmApi = (): void => {
	fetch(`${API_BASE_URL}/health`).catch(() => {});
};

// Read results kept for a few minutes, so moving between pages doesn't refetch (or re-run analysis), and
// identical requests fired together share one call. Any write clears it, and so does signing out.
// ponytail: in-memory per tab (a reload refetches); move to sessionStorage if reloads matter.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: Promise<unknown> }>();

export const clearApiCache = (): void => cache.clear();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as Promise<T>;
	const data = load();
	data.catch(() => cache.delete(key));
	cache.set(key, { at: Date.now(), data });
	return data;
}

const TOKEN_KEY = "lumen_access_token";
const USER_KEY = "lumen_user";
const TOKEN_KEY_LEGACY = "invox_access_token";
const USER_KEY_LEGACY = "invox_user";

function migrateLegacyStorage(): void {
	if (typeof window === "undefined") return;
	const legacyToken = localStorage.getItem(TOKEN_KEY_LEGACY);
	if (legacyToken && !localStorage.getItem(TOKEN_KEY)) {
		localStorage.setItem(TOKEN_KEY, legacyToken);
		localStorage.removeItem(TOKEN_KEY_LEGACY);
	}
	const legacyUser = localStorage.getItem(USER_KEY_LEGACY);
	if (legacyUser && !localStorage.getItem(USER_KEY)) {
		localStorage.setItem(USER_KEY, legacyUser);
		localStorage.removeItem(USER_KEY_LEGACY);
	}
}

export const tokenManager = {
	getToken: (): string | null => {
		if (typeof window === "undefined") return null;
		migrateLegacyStorage();
		return localStorage.getItem(TOKEN_KEY);
	},

	setToken: (token: string): void => {
		if (typeof window === "undefined") return;
		localStorage.setItem(TOKEN_KEY, token);
		document.cookie = "lumen_session=1; path=/; max-age=604800; samesite=lax";
	},

	removeToken: (): void => {
		cache.clear();
		if (typeof window === "undefined") return;
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(USER_KEY);
		localStorage.removeItem(TOKEN_KEY_LEGACY);
		localStorage.removeItem(USER_KEY_LEGACY);
		document.cookie = "lumen_session=; path=/; max-age=0; samesite=lax";
	},

	getUser: (): Record<string, unknown> | null => {
		if (typeof window === "undefined") return null;
		migrateLegacyStorage();
		const userStr = localStorage.getItem(USER_KEY);
		return userStr ? JSON.parse(userStr) : null;
	},

	setUser: (user: Record<string, unknown>): void => {
		if (typeof window === "undefined") return;
		localStorage.setItem(USER_KEY, JSON.stringify(user));
	},
};

// A page often fires several requests at once; only the first 401 should
// sign out and redirect.
let redirectingToSignIn = false;

const createApiClient = (): AxiosInstance => {
	const client = axios.create({
		baseURL: API_BASE_URL,
		headers: { "Content-Type": "application/json" },
		withCredentials: false,
	});

	client.interceptors.request.use(
		(config) => {
			const token = tokenManager.getToken();
			if (token) {
				config.headers.Authorization = `Bearer ${token}`;
			}
			return config;
		},
		(error) => Promise.reject(error)
	);

	client.interceptors.response.use(
		(response) => {
			if (response.config.method !== "get") cache.clear();
			return response;
		},
		async (error: AxiosError) => {
			if (error.response?.status === 401 && !redirectingToSignIn) {
				redirectingToSignIn = true;
				tokenManager.removeToken();
				// End the Supabase session too. Otherwise /login still sees a
				// signed-in user, bounces straight back here, gets another 401,
				// and loops forever whenever the backend rejects a live session.
				try {
					await getSupabaseBrowserClient().auth.signOut();
				} catch {
					// Supabase not configured: nothing to sign out of.
				}
				if (typeof window !== "undefined") {
					const next =
						window.location.pathname + window.location.search;
					window.location.href = `/login?reason=expired&next=${encodeURIComponent(
						next
					)}`;
				}
			}
			return Promise.reject(error);
		}
	);

	return client;
};

export const apiClient = createApiClient();

export const authApi = {
	getCurrentUser: async () => {
		const response = await apiClient.get("/api/v1/auth/me");
		return response.data;
	},

	logout: async (): Promise<void> => {
		const supabase = getSupabaseBrowserClient();
		await supabase.auth.signOut();
		tokenManager.removeToken();
		if (typeof window !== "undefined") {
			window.location.href = "/";
		}
	},
};

export const invoiceApi = {
	getMyInvoices: async (page = 1, pageSize = 100) => {
		const response = await apiClient.get("/api/v1/invoices/", {
			params: { page, page_size: pageSize },
		});
		return response.data;
	},

	uploadInvoice: async (file: File) => {
		const formData = new FormData();
		formData.append("file", file);
		const response = await apiClient.post("/extract", formData, {
			headers: { "Content-Type": "multipart/form-data" },
		});
		return response.data;
	},

	getInvoiceStats: async () => {
		const response = await apiClient.get("/api/v1/invoices/stats");
		return response.data;
	},

	getInvoice: async (invoiceId: string) => {
		const response = await apiClient.get(`/api/v1/invoices/${invoiceId}`);
		return response.data;
	},

	updateInvoice: async (
		invoiceId: string,
		data: { status?: string; [key: string]: unknown }
	) => {
		const response = await apiClient.put(
			`/api/v1/invoices/${invoiceId}`,
			data
		);
		return response.data;
	},

	deleteInvoice: async (invoiceId: string) => {
		await apiClient.delete(`/api/v1/invoices/${invoiceId}`);
	},

	exportInvoices: async (params: {
		format: "csv" | "json";
		status?: string;
		start_date?: string;
		end_date?: string;
		min_amount?: number;
		max_amount?: number;
		vendor_name?: string;
	}) => {
		const queryParams = new URLSearchParams();
		queryParams.append("format", params.format);
		if (params.status) queryParams.append("status", params.status);
		if (params.start_date)
			queryParams.append("start_date", params.start_date);
		if (params.end_date) queryParams.append("end_date", params.end_date);
		if (params.min_amount !== undefined)
			queryParams.append("min_amount", params.min_amount.toString());
		if (params.max_amount !== undefined)
			queryParams.append("max_amount", params.max_amount.toString());
		if (params.vendor_name)
			queryParams.append("vendor_name", params.vendor_name);

		const response = await apiClient.get(
			`/api/v1/invoices/export?${queryParams.toString()}`,
			{ responseType: "blob" }
		);

		const url = window.URL.createObjectURL(new Blob([response.data]));
		const link = document.createElement("a");
		link.href = url;
		let filename = `invoices_export.${params.format}`;
		const contentDisposition = response.headers["content-disposition"];
		if (contentDisposition) {
			const filenameMatch =
				contentDisposition.match(/filename="?(.+)"?/i);
			if (filenameMatch) filename = filenameMatch[1];
		}
		link.setAttribute("download", filename);
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.URL.revokeObjectURL(url);
	},

	pollEmails: async () => {
		const response = await apiClient.post("/api/v1/invoices/poll-emails");
		return response.data;
	},
};

/** Email config — identity from JWT; never send user_id from the client. */
export const emailConfigApi = {
	getStatus: async () => {
		const response = await apiClient.get("/api/v1/email-config/status");
		return response.data;
	},

	getConfig: async () => {
		const response = await apiClient.get("/api/v1/email-config");
		return response.data;
	},

	createConfig: async (data: {
		email_address: string;
		provider?: string;
		imap_server: string;
		imap_port: number;
		imap_username?: string;
		imap_password: string;
		use_ssl?: boolean;
		polling_enabled?: boolean;
		polling_interval_minutes?: number;
		folder_to_watch?: string;
		mark_as_read?: boolean;
	}) => {
		const response = await apiClient.post("/api/v1/email-config", data);
		return response.data;
	},

	updateConfig: async (data: {
		polling_enabled?: boolean;
		polling_interval_minutes?: number;
		folder_to_watch?: string;
		mark_as_read?: boolean;
		imap_password?: string;
	}) => {
		const response = await apiClient.put("/api/v1/email-config", data);
		return response.data;
	},

	deleteConfig: async () => {
		await apiClient.delete("/api/v1/email-config");
	},

	testConnection: async () => {
		const response = await apiClient.post("/api/v1/email-config/test");
		return response.data;
	},

	pollNow: async () => {
		const response = await apiClient.post("/api/v1/email-config/poll-now");
		return response.data;
	},

	pausePolling: async () => {
		const response = await apiClient.post("/api/v1/email-config/pause");
		return response.data;
	},

	resumePolling: async () => {
		const response = await apiClient.post("/api/v1/email-config/resume");
		return response.data;
	},

	getLogs: async (limit = 50) => {
		const response = await apiClient.get(
			`/api/v1/email-config/logs?limit=${limit}`
		);
		return response.data;
	},

	getGmailAuthUrl: async () => {
		const response = await apiClient.get(
			"/api/v1/email-config/gmail/auth-url"
		);
		return response.data;
	},

	gmailCallback: async (code: string, state: string) => {
		const response = await apiClient.post(
			"/api/v1/email-config/gmail/callback",
			{ code, state }
		);
		return response.data;
	},

	disconnectGmail: async () => {
		const response = await apiClient.post(
			"/api/v1/email-config/gmail/disconnect"
		);
		return response.data;
	},
};

export const ocrApi = {
	extractInvoice: async (file: File) => {
		const formData = new FormData();
		formData.append("file", file);
		const response = await apiClient.post("/extract", formData, {
			headers: { "Content-Type": "multipart/form-data" },
		});
		return response.data;
	},

	extractBatch: async (file: File) => {
		const formData = new FormData();
		formData.append("file", file);
		const response = await apiClient.post("/extract-batch", formData, {
			headers: { "Content-Type": "multipart/form-data" },
		});
		return response.data;
	},
};

export interface ChatSource {
	chunk_id: string;
	title: string;
	/** documents only; web sources (chunk_id "web:n") have url and site instead */
	section?: string;
	text: string;
	file_key?: string;
	url?: string;
	site?: string;
}

export interface ChatStep {
	tool: string;
	summary: string | null;
	latency_ms: number | null;
}

/** One Ask Lumen answer: markdown citing `[<doc id>#sNN]`, plus the evidence behind it. */
export interface ChatAnswer {
	response: string;
	sources: ChatSource[];
	steps: ChatStep[];
	proposals: string[];
	stopped: string;
	attachment?: ChatAttachment | null;
	follow_up?: string | null;
}

/** What the chat made of an attached invoice: the read fields, the checks, and the proposal that saves it. */
export interface ChatAttachment {
	invoice?: {
		vendor_name: string | null;
		invoice_number: string | null;
		date: string | null;
		currency: string | null;
		total_amount: number | null;
		items?: { item_name: string; total_price: number | null }[];
	};
	flags?: { rule: string; severity: "note" | "warn" | "fail"; detail: string }[];
	confidence?: string;
	proposal_id?: string;
	error?: string;
	code?: string;
}

/** One Ask Lumen conversation (UI revamp Phase 4). */
export interface ChatThread {
	id: string;
	title: string;
	updated_at: string | null;
	message_count: number;
}

export const chatApi = {
	/** No threadId starts a new conversation; the answer says which thread it landed in. */
	sendMessage: async (query: string, file?: File, threadId?: string | null): Promise<ChatAnswer & { thread_id: string }> => {
		const form = new FormData();
		form.append("query", query);
		if (file) form.append("file", file);
		if (threadId) form.append("thread_id", threadId);
		const response = file
			? await apiClient.post("/chat", form, { headers: { "Content-Type": undefined } })
			: await apiClient.post("/chat", threadId ? { query, thread_id: threadId } : { query });
		return response.data.data;
	},

	threads: async (): Promise<ChatThread[]> => (await apiClient.get("/chat/threads")).data.threads,

	thread: async (id: string): Promise<{ thread: { id: string; title: string }; messages: { id: string; role: "user" | "assistant"; content: string }[] }> =>
		(await apiClient.get(`/chat/threads/${encodeURIComponent(id)}`)).data,

	deleteThread: async (id: string): Promise<void> => {
		await apiClient.delete(`/chat/threads/${encodeURIComponent(id)}`);
	},

	getSuggestions: () =>
		cached("/chat/suggestions", async () => (await apiClient.get("/chat/suggestions")).data),

};

/** A user's own model / search keys (SPEC-BYOK). The key itself never comes back, only its last 4. */
export interface ProviderKey {
	provider: string;
	name: string;
	/** role -> models this provider offers for it; empty for Tavily */
	models: Record<string, string[]>;
	key: {
		last4: string;
		created_at: string;
		last_ok_at: string | null;
		last_error: string | null;
		models: Record<string, string>;
	} | null;
}

export const keysApi = {
	list: async (): Promise<{ providers: ProviderKey[]; in_use: Record<string, string> }> =>
		(await apiClient.get("/api/keys")).data,
	save: async (provider: string, key: string, models?: Record<string, string>): Promise<ProviderKey["key"]> =>
		(await apiClient.put(`/api/keys/${provider}`, { key, models })).data.key,
	test: async (provider: string): Promise<{ success: boolean; message: string }> =>
		(await apiClient.post(`/api/keys/${provider}/test`)).data,
	remove: async (provider: string): Promise<void> => {
		await apiClient.delete(`/api/keys/${provider}`);
	},
};

export const transactionApi = {
	getTransactions: async (params?: {
		page?: number;
		page_size?: number;
		date_from?: string;
		date_to?: string;
		category?: string;
		vendor?: string;
		min_amount?: number;
		max_amount?: number;
		sort_by?: string;
		sort_order?: "asc" | "desc";
		/** e.g. "statement": leave out imported bank lines */
		exclude_source?: string;
	}) => {
		const queryParams = new URLSearchParams();
		if (params?.exclude_source) queryParams.append("exclude_source", params.exclude_source);
		if (params?.page) queryParams.append("page", params.page.toString());
		if (params?.page_size)
			queryParams.append("page_size", params.page_size.toString());
		if (params?.date_from)
			queryParams.append("date_from", params.date_from);
		if (params?.date_to) queryParams.append("date_to", params.date_to);
		if (params?.category) queryParams.append("category", params.category);
		if (params?.vendor) queryParams.append("vendor", params.vendor);
		if (params?.min_amount)
			queryParams.append("min_amount", params.min_amount.toString());
		if (params?.max_amount)
			queryParams.append("max_amount", params.max_amount.toString());
		if (params?.sort_by) queryParams.append("sort_by", params.sort_by);
		if (params?.sort_order)
			queryParams.append("sort_order", params.sort_order);

		const url = `/transactions?${queryParams.toString()}`;
		return cached(url, async () => (await apiClient.get(url)).data);
	},

	updateTransaction: async (
		transactionId: string,
		data: {
			vendor_name?: string;
			invoice_number?: string;
			date?: string;
			total_amount?: number;
			tax_amount?: number;
			payment_method?: string;
			address?: string;
			category?: string;
			items?: Array<{
				item_name: string;
				quantity: number;
				unit_price: number;
				total_price: number;
			}>;
		}
	) => {
		const response = await apiClient.put(
			`/transactions/${transactionId}`,
			data
		);
		return response.data;
	},

	createTransaction: async (data: {
		vendor_name: string;
		invoice_number?: string;
		date?: string;
		total_amount?: number;
		tax_amount?: number;
		payment_method?: string;
		address?: string;
		category?: string;
		items?: Array<{
			item_name: string;
			quantity: number;
			unit_price: number;
			total_price: number;
		}>;
	}) => {
		const response = await apiClient.post("/transactions", data);
		return response.data;
	},

	deleteTransaction: async (transactionId: string) => {
		const response = await apiClient.delete(
			`/transactions/${transactionId}`
		);
		return response.data;
	},
};

// Analytics the redesigned pages still read: the forecast line on Home.
/** One month of GET /api/forecast (backend ai/forecast.py): every total is the sum of its parts. */
export interface ForecastMonth {
	month: string;
	forecast: number;
	low: number;
	high: number;
	bills: number;
	everyday: number;
	budget: number | null;
	income: number | null;
	left: number | null;
	over_budget: boolean | null;
	why: string;
	categories: { category: string; spent: number | null; forecast: number; budget: number | null }[];
}
export interface ForecastData {
	/** this month first, then the next three */
	months: ForecastMonth[];
	current: { spent_so_far: number; bills_still_due: { count: number; amount: number }; everyday_rest: number; days_left: number };
	/** this month: running total to today, and the forecast path from today to month end */
	daily: { actual: number[]; path: number[]; low: number; high: number };
	method: string;
	accuracy: { months_tested: number; method?: string; label?: string; median_error_pct?: number; in_range_pct?: number; tried?: { method: string; label: string; median_error_pct: number }[] };
	items: { vendor: string; kind: string; monthly_equivalent: number }[];
}

export const forecastApi = {
	/** `today` is the browser's YYYY-MM-DD (the server's UTC date can be a day off); null = too little history */
	get: (today: string): Promise<ForecastData | null> =>
		cached(`/api/forecast ${today}`, async () => (await apiClient.get("/api/forecast", { params: { today } })).data.forecast ?? null),
};

export const aiAnalyticsApi = {
	// insights=false skips the LLM-written insight text (Home only draws the numbers); cached like the other reads
	getForecast: (daysAhead: number = 30, insights = true) =>
		cached(`/api/analytics/forecast ${daysAhead} ${insights}`, async () =>
			(await apiClient.get("/api/analytics/forecast", {
				params: insights ? { days_ahead: daysAhead } : { days_ahead: daysAhead, insights: 0 },
			})).data),
};

export const isAuthenticated = (): boolean => {
	return tokenManager.getToken() !== null;
};

export interface LumenDocument {
	id: string;
	title: string;
	doc_type: string;
	filename: string | null;
	chunk_count: number;
	created_at: string | null;
	file_key?: string | null;
}

export interface DocumentSource {
	chunk_id: string;
	document_id: string;
	title: string;
	section: string;
	text: string;
}

export interface DocumentAnswer {
	answer: string;
	abstained: boolean;
	reason: string | null;
	sources: DocumentSource[];
}

// Document search and cited answers (SPEC-RAG), served by the FastAPI routes under /api/documents.
export const documentsApi = {
	list: async (): Promise<LumenDocument[]> => {
		const response = await apiClient.get("/api/documents");
		return response.data.documents;
	},

	upload: async (file: File, docType: string): Promise<LumenDocument> => {
		const formData = new FormData();
		formData.append("file", file);
		formData.append("doc_type", docType);
		const response = await apiClient.post("/api/documents", formData, {
			headers: { "Content-Type": "multipart/form-data" },
		});
		return response.data.document;
	},

	remove: async (documentId: string): Promise<void> => {
		await apiClient.delete(`/api/documents/${encodeURIComponent(documentId)}`);
	},

	ask: async (question: string): Promise<DocumentAnswer> => {
		const response = await apiClient.post("/api/documents/ask", { question });
		return response.data;
	},
};

export interface Proposal {
	id: string;
	type: string;
	target: string;
	risk: string;
	reason: string;
	payload: Record<string, unknown>;
	status: string;
	created_at: string | null;
}

// Home (UI revamp Phase 3). Text carries {0}/{1} placeholders filled from `amounts` in the user's currency (fill()).
export interface FoundItem {
	kind: "duplicate" | "review" | "spike" | "price_rise";
	tag: string;
	/** the vendor or category it's about (null for the review queue) */
	subject: string | null;
	headline: string;
	detail: string;
	amounts: number[];
	worth: number | null;
	href: string | null;
}
export interface ActivityItem {
	kind: "statement_import" | "receipt" | "decision";
	text: string;
	amounts: number[];
	at: string;
}
export interface HomeSummary {
	found: FoundItem[];
	more: number;
	worth_total: number;
	activity: ActivityItem[];
}
export interface BudgetState {
	month: string;
	monthly_budget: number | null;
	spent: number;
	categories: { category: string; limit: number; spent: number }[];
}

/** One recurring charge (backend ai/recurring.find_recurring) with the user's saved choice (api/bills.py). */
export interface RecurringItem {
	vendor: string;
	category: string | null;
	cadence: "weekly" | "monthly" | "yearly";
	typical_amount: number;
	last_charge_date: string;
	next_due_date: string;
	charges_count: number;
	price_change: { previous: number; latest: number; percent: number } | null;
	kind: "subscription" | "bill" | "recurring";
	possibly_stopped: boolean;
	state: "active" | "cancelled" | "charged_again";
}
export interface RecurringState {
	items: RecurringItem[];
	/** vendors the user marked "not a bill" */
	hidden: { vendor: string; vendor_key: string }[];
}

export const billsApi = {
	recurring: (): Promise<RecurringState> => cached("/api/bills/recurring", async () => (await apiClient.get("/api/bills/recurring")).data),
	setState: async (vendor: string, state: "cancelled" | "not_a_bill" | "active"): Promise<RecurringState> =>
		(await apiClient.post("/api/bills/recurring/state", { vendor, state })).data,
};

export const homeApi = {
	summary: (): Promise<HomeSummary> => cached("/api/home/summary", async () => (await apiClient.get("/api/home/summary")).data),
};

/** One month of GET /api/budget/history: `budget` is null for a past month that had none. */
export interface BudgetMonth {
	month: string;
	budget: number | null;
	spent: number;
}

export const budgetApi = {
	/** `month` "YYYY-MM"; default the current month. Limits are the ones in force that month. */
	// Every call names the browser's month: around midnight on the 1st the server's (UTC) date can be a month off.
	get: async (month: string): Promise<BudgetState> => (await apiClient.get("/api/budget", { params: { month } })).data,
	history: async (months: number, to: string): Promise<BudgetMonth[]> => (await apiClient.get("/api/budget/history", { params: { months, to } })).data.months,
	put: async (body: { month: string; monthly_budget?: number | null; categories?: { category: string; limit: number | null }[] }): Promise<BudgetState> =>
		(await apiClient.put("/api/budget", body)).data,
	/** Files set_budget proposals (nothing is saved until each is approved); [] = not enough history. */
	draft: async (): Promise<Proposal[]> => (await apiClient.post("/api/budget/draft")).data.proposals,
};

// The agent's proposals (SPEC-AGENT), served by the FastAPI routes under /api/agent. Questions go through chatApi.
export const agentApi = {
	proposals: async (): Promise<Proposal[]> => {
		const response = await apiClient.get("/api/agent/proposals", { params: { status: "pending" } });
		return response.data.proposals;
	},

	/** `applied` is set when approving changed something; a saved invoice reports its review `status` ("flagged" = needs a look). */
	decide: async (id: string, decision: "approve" | "reject"): Promise<{ status?: string } | null> => {
		const response = await apiClient.post(`/api/agent/proposals/${encodeURIComponent(id)}/${decision}`);
		return response.data.applied ?? null;
	},
};

export interface ReviewFlag {
	rule: string;
	severity: "warn" | "fail" | "note"; // note: a warning not raised because you kept approving it
	detail: string;
}

export interface ReviewItem {
	id: string;
	status: "flagged" | "approved" | "rejected";
	confidence: "high" | "medium" | "low";
	invoice: Record<string, unknown>;
	flags: ReviewFlag[];
	transaction_id: string | null;
	note: string | null;
	created_at: string | null;
}

// Review queue (SPEC-EXTRACT): invoices the checks weren't sure about.
export const reviewApi = {
	list: async (): Promise<ReviewItem[]> => {
		const response = await apiClient.get("/api/review", { params: { status: "flagged" } });
		return response.data.items;
	},

	/** Just the number waiting (the sidebar badge). */
	count: async (): Promise<number> => {
		const response = await apiClient.get("/api/review", { params: { status: "flagged", count: 1 } });
		return response.data.count ?? 0;
	},

	decide: async (id: string, decision: "approve" | "reject", body: { edits?: Record<string, unknown>; note?: string } = {}): Promise<ReviewItem> => {
		const response = await apiClient.post(`/api/review/${encodeURIComponent(id)}/${decision}`, body);
		return response.data.item;
	},
};

// Original uploads (invoices, documents) are only served to their owner, so fetch with the token and open a blob.
export const filesApi = {
	open: async (key: string): Promise<void> => {
		const response = await apiClient.get(`/api/files/${key}`, { responseType: "blob" });
		window.open(URL.createObjectURL(response.data as Blob), "_blank", "noopener");
	},
};

// SPEC-ONBOARD profile (backend/api/profile.py).
export type Goal =
	| "save_more"
	| "cut_subscriptions"
	| "stay_on_budget"
	| "pay_off_debt"
	| "emergency_fund"
	| "big_purchase"
	| "business_expenses";
export type Profile = {
	display_name: string | null;
	avatar_key: string | null;
	currency: string | null;
	monthly_income: number | null;
	monthly_budget: number | null;
	use_case: "personal" | "household" | "business" | null;
	goals: Goal[];
	onboarded: boolean;
	demo: boolean;
};
export type ProfileInput = Omit<Profile, "avatar_key" | "onboarded" | "demo">;

export const profileApi = {
	get: async (): Promise<Profile> => (await apiClient.get("/api/profile")).data.profile,
	update: async (p: Partial<ProfileInput> & { complete?: boolean }): Promise<Profile> =>
		(await apiClient.put("/api/profile", p)).data.profile,
	uploadAvatar: async (file: Blob): Promise<Profile> => {
		const form = new FormData();
		form.append("file", file, "avatar.jpg");
		// Let the browser set multipart/form-data with its boundary (the client defaults to JSON).
		return (await apiClient.put("/api/profile/avatar", form, { headers: { "Content-Type": undefined } })).data
			.profile;
	},
	// The bucket is private: fetch with the token and show it as an object URL.
	avatarUrl: async (key: string): Promise<string> =>
		URL.createObjectURL((await apiClient.get(`/api/files/${key}`, { responseType: "blob" })).data),
};

export type StatementMapping = Record<"date" | "description" | "debit" | "credit" | "amount" | "drcr", number | null>;
export type StatementPreview = {
	columns: string[];
	mapping: StatementMapping;
	header_line: number;
	sample: { line: number; date: string | null; description: string; amount: number | null; kind: string | null }[];
	counts: { rows: number; debits: number; credits: number; unreadable: number };
};
export type StatementResult = {
	imported: number;
	duplicates: number;
	matched: number;
	credits: number;
	unreadable: number[];
};

const upload = (file: File, extra: Record<string, string> = {}) => {
	const form = new FormData();
	form.append("file", file);
	for (const [k, v] of Object.entries(extra)) form.append(k, v);
	return form;
};

/** One statement import (GET /api/statements/imports); counts as the import returned them. */
export interface StatementImport {
	id: string;
	file_name: string | null;
	label: string | null;
	period_from: string | null;
	period_to: string | null;
	lines: number;
	imported: number;
	matched: number;
	duplicates: number;
	credits: number;
	unreadable: number;
	created_at: string;
}

export const statementApi = {
	imports: async (): Promise<StatementImport[]> => (await apiClient.get("/api/statements/imports")).data.imports,
	preview: async (file: File): Promise<StatementPreview> =>
		(await apiClient.post("/api/statements/preview", upload(file), { headers: { "Content-Type": undefined } })).data,
	import: async (file: File, mapping: StatementMapping, currency: string, headerLine: number, label = ""): Promise<StatementResult> =>
		(
			await apiClient.post(
				"/api/statements/import",
				upload(file, { mapping: JSON.stringify(mapping), currency, header_line: String(headerLine), ...(label.trim() ? { label: label.trim() } : {}) }),
				{ headers: { "Content-Type": undefined } },
			)
		).data,
};

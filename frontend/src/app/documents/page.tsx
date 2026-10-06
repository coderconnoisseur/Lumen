import { AuthGuard } from "@/components/auth/auth-guard";
import DocumentsContent from "./documentsContent";

export default function DocumentsPage() {
	return (
		<AuthGuard>
			<DocumentsContent />
		</AuthGuard>
	);
}

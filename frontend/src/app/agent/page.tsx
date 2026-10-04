import { AuthGuard } from "@/components/auth/auth-guard";
import AgentContent from "./agentContent";

export default function AgentPage() {
	return (
		<AuthGuard>
			<AgentContent />
		</AuthGuard>
	);
}

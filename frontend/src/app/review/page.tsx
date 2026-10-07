import { AuthGuard } from "@/components/auth/auth-guard";
import ReviewContent from "./reviewContent";

export default function ReviewPage() {
	return (
		<AuthGuard>
			<ReviewContent />
		</AuthGuard>
	);
}

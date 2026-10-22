import type { Metadata } from "next";
import ChatbotContent from "./chatbotContent";

export const metadata: Metadata = { title: "Ask Lumen" };

export default function Page() {
	return <ChatbotContent />;
}

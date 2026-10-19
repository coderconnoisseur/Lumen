import type { Metadata } from "next";
import SettingsContent from "./settingsContent";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
	return <SettingsContent />;
}

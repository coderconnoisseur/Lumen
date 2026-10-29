import type { Metadata } from "next";
import ForecastContent from "./forecast-content";

export const metadata: Metadata = { title: "Forecast" };

export default function Page() {
	return <ForecastContent />;
}

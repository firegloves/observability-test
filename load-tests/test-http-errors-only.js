import {
	executeHttpErrorScenario,
	executeMixedHttpErrorScenario,
} from "./scenarios/modules/http-error-scenarios.js";

export const options = {
	duration: "30s",
	vus: 3,
};

export default function () {
	const baseUrl = "http://localhost:8081";

	// 50% specific scenarios, 50% mixed
	if (Math.random() < 0.5) {
		console.log("🎯 Executing specific HTTP error scenario");
		executeHttpErrorScenario(baseUrl);
	} else {
		console.log("🎲 Executing mixed HTTP error scenario");
		executeMixedHttpErrorScenario(baseUrl);
	}
}

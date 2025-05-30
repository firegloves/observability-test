import { metrics } from "@opentelemetry/api";
import {
	SEMATTRS_CODE_FILEPATH,
	SEMATTRS_CODE_FUNCTION,
} from "@opentelemetry/semantic-conventions";
import { getAppTracer } from "./tracing";

const APP_METER_NAME = "observability-test";
const APP_METER_VERSION = "1.0.0";

const meter = metrics.getMeter(APP_METER_NAME, APP_METER_VERSION);

export const getMeterCounter = (name: string, description: string) => {
	return meter.createCounter(name, {
		description,
	});
};

export const getMeterHistogram = (name: string, description: string) => {
	return meter.createHistogram(name, {
		description,
	});
};

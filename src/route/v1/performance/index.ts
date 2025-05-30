import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
	ERROR_401_RESPONSE_SCHEMA,
	ERROR_404_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
	GENERIC_SUCCESS_RESPONSE_SCHEMA,
} from "../../types";
import {
	getMeterCounter,
	getMeterHistogram,
} from "../../../observability/metricHelper";
import { withActiveSpan } from "../../../observability/spanHelper";

const slowEndpointCounter = getMeterCounter(
	"slow_endpoint_requests_total",
	"Total number of slow endpoint requests",
);

const slowEndpointDurationHistogram = getMeterHistogram(
	"slow_endpoint_duration_seconds",
	"Duration of slow endpoint requests in seconds",
);

const latencySimulationHistogram = getMeterHistogram(
	"latency_simulation_seconds",
	"Simulated latency duration in seconds",
);

// Request schema for slow endpoint
const SLOW_REQUEST_SCHEMA = z.object({
	latency_ms: z
		.number()
		.min(100, "Minimum latency is 100ms")
		.max(5000, "Maximum latency is 5000ms")
		.default(1000),
	operation_type: z
		.enum(["database", "external_api", "computation", "generic"])
		.default("generic"),
});

// Response schema
const SLOW_RESPONSE_DATA_SCHEMA = z.object({
	requested_latency_ms: z.number(),
	actual_duration_ms: z.number(),
	operation_type: z.string(),
	timestamp: z.string(),
});

const SUCCESS_SLOW_RESPONSE_SCHEMA = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: SLOW_RESPONSE_DATA_SCHEMA,
});

const SLOW_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	SUCCESS_SLOW_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);

type SlowResponse = z.infer<typeof SLOW_RESPONSE_SCHEMA>;
type SlowRequest = z.infer<typeof SLOW_REQUEST_SCHEMA>;

// Utility function to simulate delay
const simulateDelay = async (ms: number): Promise<void> => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};

const route: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	app.post(
		"/slow",
		{
			schema: {
				body: SLOW_REQUEST_SCHEMA,
				response: {
					200: SUCCESS_SLOW_RESPONSE_SCHEMA,
					401: ERROR_401_RESPONSE_SCHEMA,
					404: ERROR_404_RESPONSE_SCHEMA,
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<SlowResponse> => {
			const startTime = process.hrtime();
			const requestStart = Date.now();

			try {
				const { latency_ms, operation_type }: SlowRequest = request.body;

				request.log.info(
					{ latency_ms, operation_type },
					"#### Processing slow endpoint request",
				);

				// Increment request counter
				slowEndpointCounter.add(1, {
					operation_type,
					route: "/performance/slow",
				});

				await withActiveSpan(`SlowEndpoint.${operation_type}`, async (span) => {
					// Add custom span attributes
					span.setAttributes({
						"operation.type": operation_type,
						"operation.latency_ms": latency_ms,
						"endpoint.name": "slow",
						"test.scenario": "performance",
					});

					// Record latency simulation start
					const latencyStart = process.hrtime();

					// Simulate the requested latency
					await simulateDelay(latency_ms);

					// Record actual latency simulation duration
					const latencyDuration = process.hrtime(latencyStart);
					const latencySeconds = latencyDuration[0] + latencyDuration[1] / 1e9;
					latencySimulationHistogram.record(latencySeconds, {
						operation_type,
					});

					// Add span event
					span.addEvent("latency_simulation_completed", {
						requested_ms: latency_ms,
						actual_ms: latencySeconds * 1000,
					});
				});

				const actualDuration = Date.now() - requestStart;
				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;

				// Record total duration
				slowEndpointDurationHistogram.record(totalSeconds, {
					operation_type,
					success: "true",
				});

				request.log.info(
					{
						latency_ms,
						actual_duration_ms: actualDuration,
						operation_type,
					},
					"#### Slow endpoint request completed successfully",
				);

				reply.status(200);
				return {
					success: true,
					data: {
						requested_latency_ms: latency_ms,
						actual_duration_ms: actualDuration,
						operation_type,
						timestamp: new Date().toISOString(),
					},
				};
			} catch (error) {
				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;

				slowEndpointDurationHistogram.record(totalSeconds, {
					operation_type: "unknown",
					success: "false",
				});

				request.log.error(
					{ err: error, body: request.body },
					"#### Failed to process slow endpoint request",
				);

				reply.status(500);
				return {
					success: false,
					error: "Internal server error",
				};
			}
		},
	);
};

export default route;

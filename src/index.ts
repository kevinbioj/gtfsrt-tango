import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { serve } from "@hono/node-server";
import GtfsRealtime from "gtfs-realtime-bindings";
import { Hono } from "hono";
import { stream } from "hono/streaming";

import { downloadGtfs } from "./gtfs/download-gtfs.js";
import { importTripIds } from "./gtfs/import-trip-ids.js";

const GTFS_URL =
	"https://www.data.gouv.fr/api/1/datasets/r/15aeb8a5-1cca-4bb9-ae5f-b6e67e4ff2ab";
const GTFSRT_TU = "https://transport.data.gouv.fr/resources/80731/download";
const GTFSRT_VP = "https://transport.data.gouv.fr/resources/80732/download";

console.log("▸ Loading GTFS resource...");
const gtfsDirectory = await mkdtemp(tmpdir());
await downloadGtfs(GTFS_URL, gtfsDirectory);
const tripIds = await importTripIds(gtfsDirectory);
console.log("✓ Loaded GTFS resource.");

console.log("▸ Instantiating web server...");
const hono = new Hono();
hono.get("/trip-updates", async (c) => {
	try {
		const patchedPayload = await patchGtfsRt(GTFSRT_TU);
		if (c.req.query("format") === "json")
			return c.json(patchedPayload.toJSON());
		return stream(c, async (stream) => {
			const encoded = await encodeGtfsRt(patchedPayload);
			await stream.write(encoded);
		});
	} catch (e) {
		console.error(e);
		return c.redirect(GTFSRT_TU);
	}
});
hono.get("/vehicle-positions", async (c) => {
	try {
		const patchedPayload = await patchGtfsRt(GTFSRT_VP);
		if (c.req.query("format") === "json")
			return c.json(patchedPayload.toJSON());
		return stream(c, async (stream) => {
			const encoded = await encodeGtfsRt(patchedPayload);
			await stream.write(encoded);
		});
	} catch (e) {
		console.error(e);
		return c.redirect(GTFSRT_VP);
	}
});
serve({ fetch: hono.fetch, port: +(process.env.PORT ?? 3000) });
console.log("✓ Instantiated web server.");

// ---

const findActualTripId = (input: string) => {
	const slicedInput = input.slice(3);
	return (
		tripIds.find((tripId) => tripId.startsWith(slicedInput)) ?? slicedInput
	);
};

async function patchGtfsRt(feedUrl: string) {
	const response = await fetch(feedUrl);
	if (!response.ok) throw new Error("Failed to fetch GTFS-RT");

	const buffer = Buffer.from(await response.arrayBuffer());
	const payload = GtfsRealtime.transit_realtime.FeedMessage.decode(buffer);

	for (const entity of payload.entity) {
		if (entity.tripUpdate?.trip.tripId) {
			entity.tripUpdate.trip.tripId = findActualTripId(
				entity.tripUpdate.trip.tripId,
			);
		}

		for (const stopTimeUpdate of entity.tripUpdate?.stopTimeUpdate ?? []) {
			if (stopTimeUpdate.stopId) {
				stopTimeUpdate.stopId = stopTimeUpdate.stopId.slice(2);
			}
		}

		if (entity.vehicle?.trip?.tripId) {
			entity.vehicle.trip.tripId = findActualTripId(entity.vehicle.trip.tripId);
		}

		if (entity.vehicle?.stopId) {
			entity.vehicle.stopId = findActualTripId(entity.vehicle.stopId);
		}
	}

	return payload;
}

async function encodeGtfsRt(
	payload: GtfsRealtime.transit_realtime.FeedMessage,
) {
	return GtfsRealtime.transit_realtime.FeedMessage.encode(payload).finish();
}

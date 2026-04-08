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

const REFRESH_INTERVAL_MS = +(process.env.REFRESH_INTERVAL_MS ?? 15_000);

type FeedCache = {
	payload: GtfsRealtime.transit_realtime.FeedMessage;
	encoded: Uint8Array;
} | null;

let cacheTU: FeedCache = null;
let cacheVP: FeedCache = null;

async function refreshCache(feedUrl: string, label: string) {
	try {
		const payload = await patchGtfsRt(feedUrl);
		const encoded = await encodeGtfsRt(payload);
		return { payload, encoded };
	} catch (e) {
		console.error(`Failed to refresh cache for ${label}:`, e);
		return null;
	}
}

console.log("▸ Fetching initial GTFS-RT data...");
[cacheTU, cacheVP] = await Promise.all([
	refreshCache(GTFSRT_TU, "trip-updates"),
	refreshCache(GTFSRT_VP, "vehicle-positions"),
]);
console.log("✓ Initial GTFS-RT data fetched.");

setInterval(async () => {
	const [tu, vp] = await Promise.all([
		refreshCache(GTFSRT_TU, "trip-updates"),
		refreshCache(GTFSRT_VP, "vehicle-positions"),
	]);
	if (tu) cacheTU = tu;
	if (vp) cacheVP = vp;
}, REFRESH_INTERVAL_MS);

console.log("▸ Instantiating web server...");
const hono = new Hono();
hono.get("/trip-updates", async (c) => {
	if (!cacheTU) return c.redirect(GTFSRT_TU);
	if (c.req.query("format") === "json")
		return c.json(cacheTU.payload.toJSON());
	return stream(c, async (stream) => {
		await stream.write(cacheTU!.encoded);
	});
});
hono.get("/vehicle-positions", async (c) => {
	if (!cacheVP) return c.redirect(GTFSRT_VP);
	if (c.req.query("format") === "json")
		return c.json(cacheVP.payload.toJSON());
	return stream(c, async (stream) => {
		await stream.write(cacheVP!.encoded);
	});
});
serve({ fetch: hono.fetch, port: +(process.env.PORT ?? 3000) });
console.log("✓ Instantiated web server.");

// ---

const findActualTripId = (input: string) => {
	const slicedInput = input.slice(3);
	return (
		tripIds.find((tripId) => tripId?.startsWith(slicedInput)) ?? slicedInput
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
			entity.vehicle.stopId = entity.vehicle.stopId.slice(2);
		}
	}

	return payload;
}

async function encodeGtfsRt(
	payload: GtfsRealtime.transit_realtime.FeedMessage,
) {
	return GtfsRealtime.transit_realtime.FeedMessage.encode(payload).finish();
}

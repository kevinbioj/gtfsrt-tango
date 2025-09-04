import { readFile } from "node:fs/promises";
import { join } from "node:path";

import Papaparse from "papaparse";

export async function importTripIds(gtfsDirectory: string) {
	const tripsPath = join(gtfsDirectory, "trips.txt");
	const tripsContents = (await readFile(tripsPath)).toString();
	const { data } = Papaparse.parse<{ trip_id?: string }>(tripsContents, {
		header: true,
    skipEmptyLines: true,
	});
	return data.map((trip) => trip.trip_id);
}

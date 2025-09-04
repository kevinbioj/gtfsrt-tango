import decompress from "decompress";

export async function downloadGtfs(url: string, destination: string) {
	const response = await fetch(url);
	if (!response.ok) throw new Error("Failed to fetch GTFS archive");

	const arrayBuffer = await response.arrayBuffer();
	await decompress(Buffer.from(arrayBuffer), destination);
}

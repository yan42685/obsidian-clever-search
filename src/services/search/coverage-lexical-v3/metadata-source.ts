export const IDENTITY_METADATA_SOURCE_BASENAME = 1 << 0;
export const IDENTITY_METADATA_SOURCE_ALIAS = 1 << 1;

export const ROUTE_METADATA_SOURCE_TAG = 1 << 0;
export const ROUTE_METADATA_SOURCE_FOLDER = 1 << 1;

export type IdentityMetadataSource = "none" | "basename" | "alias" | "both";

export type RouteMetadataSource = "none" | "tag" | "folder" | "both";

export type MetadataPackingSource = "basename" | "alias" | "route" | "none";

export function decodeIdentityMetadataSource(mask: number): IdentityMetadataSource {
	const normalizedMask =
		mask & (IDENTITY_METADATA_SOURCE_BASENAME | IDENTITY_METADATA_SOURCE_ALIAS);
	if (normalizedMask === IDENTITY_METADATA_SOURCE_BASENAME) {
		return "basename";
	}
	if (normalizedMask === IDENTITY_METADATA_SOURCE_ALIAS) {
		return "alias";
	}
	if (
		normalizedMask ===
		(IDENTITY_METADATA_SOURCE_BASENAME | IDENTITY_METADATA_SOURCE_ALIAS)
	) {
		return "both";
	}
	return "none";
}

export function decodeRouteMetadataSource(mask: number): RouteMetadataSource {
	const normalizedMask =
		mask & (ROUTE_METADATA_SOURCE_TAG | ROUTE_METADATA_SOURCE_FOLDER);
	if (normalizedMask === ROUTE_METADATA_SOURCE_TAG) {
		return "tag";
	}
	if (normalizedMask === ROUTE_METADATA_SOURCE_FOLDER) {
		return "folder";
	}
	if (
		normalizedMask ===
		(ROUTE_METADATA_SOURCE_TAG | ROUTE_METADATA_SOURCE_FOLDER)
	) {
		return "both";
	}
	return "none";
}

export function chooseMetadataPackingSource(
	identitySource: IdentityMetadataSource,
	routeSource: RouteMetadataSource,
): MetadataPackingSource {
	if (identitySource === "basename" || identitySource === "both") {
		return "basename";
	}
	if (identitySource === "alias") {
		return "alias";
	}
	if (routeSource !== "none") {
		return "route";
	}
	return "none";
}

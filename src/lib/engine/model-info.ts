/**
 * Model identifiers.
 *
 * Kept out of `embed.ts` because that module is client-only, and the server
 * components on `/assay` and `/` need to *name* the model without importing the
 * inference path.
 */

export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2 (int8, on-device)";
export const EMBEDDING_REPO = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_LICENSE = "Apache-2.0";
export const EMBEDDING_PARAMETERS = "22M";
export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_DOWNLOAD_HINT = "roughly 23 MB, fetched once and then cached by the browser";
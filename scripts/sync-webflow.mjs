import { readFile, writeFile } from "node:fs/promises";

const token = process.env.WEBFLOW_API_TOKEN;
const siteId = process.env.WEBFLOW_SITE_ID;
if (!token || !siteId) {
  throw new Error("Set WEBFLOW_API_TOKEN and WEBFLOW_SITE_ID in GitHub repository Actions secrets.");
}

const headers = { Authorization: "Bearer " + token, Accept: "application/json" };
async function api(path) {
  const response = await fetch("https://api.webflow.com/v2" + path, { headers });
  if (!response.ok) throw new Error("Webflow API returned HTTP " + response.status + " for " + path);
  return response.json();
}
async function paginated(path, key) {
  const result = [];
  for (let offset = 0; offset < 100000; offset += 100) {
    const page = await api(path + (path.includes("?") ? "&" : "?") + "limit=100&offset=" + offset);
    const batch = Array.isArray(page[key]) ? page[key] : [];
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error("Webflow API pagination exceeded 100,000 records for " + path);
}

const oldData = JSON.parse(await readFile("cms-data.json", "utf8"));
if (oldData.siteId && oldData.siteId !== siteId) {
  throw new Error("WEBFLOW_SITE_ID does not match the site that was exported into this ZIP.");
}
const site = await api("/sites/" + encodeURIComponent(siteId));
const [pages, rawCollections] = await Promise.all([
  paginated("/sites/" + encodeURIComponent(siteId) + "/pages", "pages"),
  paginated("/sites/" + encodeURIComponent(siteId) + "/collections", "collections")
]);
const collections = [];
for (const collection of rawCollections) {
  const id = String(collection.id || "");
  if (!id) continue;
  let schema = null;
  try {
    schema = await api("/collections/" + encodeURIComponent(id));
  } catch (error) {
    console.error("Could not refresh schema for " + (collection.displayName || id) + ": " + error.message);
  }
  const items = await paginated("/collections/" + encodeURIComponent(id) + "/items", "items");
  collections.push({
    id,
    name: collection.displayName || collection.singularName || id,
    slug: (schema && schema.slug) || collection.slug || "",
    schema,
    collectionTemplate: pages.find(function (page) {
      const nested = page.collection && page.collection.id;
      return String(page.collectionId || page.cmsCollectionId || nested || "") === id;
    }) || null,
    items
  });
}
const data = {
  source: "Webflow CMS API v2",
  siteId,
  siteName: site.displayName || site.shortName || site.name || "Webflow site",
  sourceUrl: oldData.sourceUrl,
  assetPaths: oldData.assetPaths || {},
  publishedPages: oldData.publishedPages || [],
  refreshedAt: new Date().toISOString(),
  pages,
  collections
};
await writeFile("cms-data.json", JSON.stringify(data, null, 2) + "\n");
console.log("Refreshed " + collections.length + " CMS collections from Webflow.");

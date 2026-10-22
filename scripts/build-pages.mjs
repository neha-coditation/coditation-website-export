import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "site");
const data = JSON.parse(await readFile(path.join(root, "cms-data.json"), "utf8"));
const assetPaths = data.assetPaths || {};
const previousManifest = path.join(out, "cms-generated-manifest.json");
try {
  const previous = JSON.parse(await readFile(previousManifest, "utf8"));
  for (const file of previous.files || []) {
    const safe = String(file).split("/").filter(Boolean);
    if (safe.some(function (part) { return part === "." || part === ".." || part.includes("\\"); })) continue;
    const target = path.resolve(out, ...safe);
    if (target.startsWith(out + path.sep)) await rm(target, { force: true });
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const esc = function (value) {
  return String(value).replace(/[&<>"]/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char];
  });
};
const safeRoute = function (value) {
  const parts = String(value || "").split("/").filter(Boolean).map(function (part) {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts.some(function (part) { return part === "." || part === ".." || part.includes("/") || part.includes("\\"); })) return "";
  return parts.join("/");
};
const routeKey = function (value) {
  return "/" + String(value || "").split(/[?#]/, 1)[0].split("/").filter(Boolean).map(function (part) {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join("/");
};
const sourceRouteByPath = new Map();
for (const source of data.publishedPages || []) {
  const route = safeRoute(source.route);
  const archive = safeRoute(source.archive);
  if (!route || !archive) continue;
  try { sourceRouteByPath.set(routeKey(new URL(source.url).pathname), route); } catch {}
  const target = path.resolve(out, route);
  if (!target.startsWith(out + path.sep)) continue;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.resolve(root, archive), target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const slugOf = function (item) {
  return String((item.fieldData && item.fieldData.slug) || item.slug || "").trim().replace(/^\/+|\/+$/g, "");
};
const assetUrl = function (url, route) {
  const local = assetPaths[url];
  if (!local) return url;
  return path.posix.relative(path.posix.dirname(route + "/index.html"), String(local));
};
const valueHtml = function (value, depth, route) {
  if (value === null || value === undefined || depth > 5) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value);
    if (/^https?:\/\/\S+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]\S*)?$/i.test(text)) {
      return '<img class="cms-image" src="' + esc(assetUrl(text, route)) + '" alt="">';
    }
    if (/^https?:\/\//i.test(text)) return '<a href="' + esc(text) + '">' + esc(text) + "</a>";
    return "<p>" + esc(text) + "</p>";
  }
  if (Array.isArray(value)) return value.map(function (part) { return valueHtml(part, depth + 1, route); }).join("");
  if (typeof value === "object") {
    if (typeof value.url === "string" && /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(value.url)) {
      return '<img class="cms-image" src="' + esc(assetUrl(value.url, route)) + '" alt="' + esc(value.alt || "") + '">';
    }
    return Object.keys(value).map(function (key) {
      return '<div class="cms-field"><h3>' + esc(key.replace(/[-_]/g, " ")) + "</h3>" + valueHtml(value[key], depth + 1, route) + "</div>";
    }).join("");
  }
  return "";
};
const style = "body{margin:0;background:#f6f7f9;color:#1e293b;font:16px/1.6 system-ui,sans-serif}.cms-wrap{max-width:1080px;margin:0 auto;padding:36px 22px}.cms-nav{font-size:13px;color:#64748b}.cms-title{font-size:clamp(30px,5vw,48px);line-height:1.1;letter-spacing:-.04em}.cms-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}.cms-card,.cms-body{padding:22px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 28px #0f172a0a}.cms-card a{color:#1d4ed8;text-decoration:none}.cms-image{display:block;width:100%;height:auto;max-height:440px;object-fit:cover;border-radius:10px}.cms-field{margin:18px 0}.cms-field h3{font-size:13px;text-transform:capitalize;color:#64748b}.cms-field p{white-space:pre-wrap}.cms-footer{margin-top:36px;color:#64748b;font-size:12px}";
const page = function (title, body, description, canonical) {
  const head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + "</title>" +
    (description ? '<meta name="description" content="' + esc(description) + '">' : "") +
    (canonical ? '<link rel="canonical" href="' + esc(canonical) + '">' : "") +
    "<style>" + style + "</style></head><body>" + body + "</body></html>";
  return head;
};
const writePage = async function (route, html) {
  const safe = safeRoute(route);
  if (!safe) throw new Error("Unsafe generated CMS route: " + route);
  const target = path.resolve(out, safe, "index.html");
  if (!target.startsWith(out + path.sep)) throw new Error("Generated route escapes the Pages output folder.");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html);
  generatedPaths.add(path.relative(out, target).split(path.sep).join("/"));
};
const cmsIndex = [];
const generatedPaths = new Set();
const routesWritten = new Set();
const referenceOnlyCollections = [];
for (const collection of data.collections || []) {
  const templatePath = String((collection.collectionTemplate && collection.collectionTemplate.publishedPath) || "");
  if (!collection.collectionTemplate || !templatePath) {
    referenceOnlyCollections.push({
      collection: collection.name,
      id: collection.id,
      items: (collection.items || []).length,
      reason: "No published Webflow collection template path was available."
    });
    continue;
  }
  const templateBase = templatePath.replace(/\/?(?:\{(?:slug|itemSlug|name)\}|:(?:slug|itemSlug|name))\/?$/i, "").replace(/\/+$/, "");
  const base = safeRoute(templateBase);
  if (!base) {
    console.warn("Skipping route generation for collection without a route: " + collection.name);
    continue;
  }
  const entries = (collection.items || []).filter(function (item) {
    const unpublished = item.isDraft || (Object.prototype.hasOwnProperty.call(item, "lastPublished") && !item.lastPublished);
    return !unpublished && !item.isArchived;
  });
  const detailWrites = [];
  const rendered = entries.map(function (item) {
    const fields = item.fieldData || {};
    const slug = slugOf(item);
    if (!slug || slug.includes("/") || !safeRoute(slug)) {
      console.warn("Skipping item with missing/unsafe slug in " + collection.name);
      return null;
    }
    const route = base + "/" + safeRoute(slug);
    if (routesWritten.has(route)) {
      console.warn("Skipping duplicate CMS route " + route);
      return null;
    }
    routesWritten.add(route);
    const name = fields.name || item.name || slug;
    const sourceRoute = sourceRouteByPath.get(routeKey(route));
    const itemHref = sourceRoute
      ? path.posix.relative(path.posix.dirname(base + "/index.html"), sourceRoute)
      : "./" + encodeURIComponent(slug) + "/";
    const image = Object.keys(fields).map(function (key) { return fields[key]; }).find(function (value) {
      return value && typeof value === "object" && typeof value.url === "string" && /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(value.url);
    });
    const card = '<article class="cms-card">' +
      (image ? '<a href="' + esc(itemHref) + '"><img class="cms-image" src="' + esc(assetUrl(image.url, base)) + '" alt="' + esc(image.alt || "") + '"></a>' : "") +
      '<h2><a href="' + esc(itemHref) + '">' + esc(name) + "</a></h2>" +
      (fields.summary || fields.description ? "<p>" + esc(fields.summary || fields.description) + "</p>" : "") +
      "</article>";
    const detailFields = Object.keys(fields).filter(function (key) { return key !== "slug"; }).map(function (key) {
      return '<section class="cms-field"><h2>' + esc(key.replace(/[-_]/g, " ")) + "</h2>" + valueHtml(fields[key], 0, route) + "</section>";
    }).join("");
    const canonical = "./";
    if (!sourceRoute) {
      detailWrites.push(writePage(route, page(String(name), '<main class="cms-wrap"><nav class="cms-nav"><a href="../">All ' + esc(collection.name) + "</a></nav><h1 class=\"cms-title\">" + esc(name) + '</h1><article class="cms-body">' + detailFields + '</article><footer class="cms-footer">Content from ' + esc(data.siteName || "Webflow CMS") + "</footer></main>", "", canonical)));
    }
    return card;
  }).filter(Boolean);
  const canonical = "./";
  await Promise.all(detailWrites);
  const listing = '<main class="cms-wrap"><nav class="cms-nav">' + esc(data.siteName || "Website") + "</nav><h1 class=\"cms-title\">" + esc(collection.name) + '</h1><section class="cms-grid">' + rendered.join("") + '</section><footer class="cms-footer">Collection refreshed ' + esc(data.refreshedAt || "at build time") + "</footer></main>";
  await writePage(base, page(collection.name, listing, "", canonical));
  cmsIndex.push({ collection: collection.name, route: canonical, items: rendered.length });
}
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "cms-manifest.json"), JSON.stringify({
  siteName: data.siteName,
  sourceUrl: data.sourceUrl,
  cmsUpdatedAt: data.refreshedAt || null,
  collections: cmsIndex,
  referenceOnlyCollections
}, null, 2) + "\n");
await writeFile(previousManifest, JSON.stringify({ files: Array.from(generatedPaths) }, null, 2) + "\n");
await writeFile(path.join(out, ".nojekyll"), "");
console.log("Generated " + cmsIndex.length + " CMS collection listing(s) and " + cmsIndex.reduce(function (sum, entry) { return sum + entry.items; }, 0) + " CMS item page(s).");
if (referenceOnlyCollections.length) {
  console.log("Preserved " + referenceOnlyCollections.length + " collection(s) as structured CMS data because no published collection template route was available.");
}

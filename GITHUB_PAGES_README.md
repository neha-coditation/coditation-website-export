# Publish this export with GitHub Pages

1. Extract this ZIP and upload its contents to the root of your GitHub repository (or commit and push them).
2. In repository Settings > Pages, choose GitHub Actions as the build and deployment source.
3. The included workflow builds and publishes the `site/` folder on pushes to `main`.
4. To sync Webflow CMS automatically, add repository Actions secrets `WEBFLOW_API_TOKEN` and `WEBFLOW_SITE_ID`. Run the workflow manually to test; it will also refresh every six hours.

CMS collection listing pages and item detail routes are generated from `cms-data.json` using generic static templates only when Webflow returned a published collection-template path. Collections without such a template remain structured data and are identified in `site/cms-manifest.json`.
New CMS items become live after the scheduled/manual Webflow sync and successful Pages deployment. GitHub Pages is static hosting: it cannot run the Webflow CMS API or create routes dynamically at request time.
Original published HTML snapshots are preserved in `source-pages/`; CMS generated routes are generated into `site/` and may take precedence over a source page at the same collection route.
Content or behavior requiring login, browser execution, the original site's runtime, or third-party server APIs is not converted by this static generator. Check `export-report.json` and `cms-data.json` before deploying.
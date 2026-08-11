// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// The site is published to the custom domain https://claude-foundation.dev
// (configured on the repository's Pages settings), so the landing page is served
// at the domain ROOT — not under a /claude-foundation/ repository subpath, which
// is only how the bare github.io URL would address it. `base` must therefore be
// just "/docs"; getting this wrong 404s every internal link in production while
// still looking correct under `astro dev`.
export default defineConfig({
  site: "https://claude-foundation.dev",
  base: "/docs",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Claude Foundation",
      description:
        "An OpenSpec-native change harness for AI coding agents: agree on the change, build it in isolation, prove it with real evidence, then land it.",
      tagline: "Prove the change. Skip the ceremony.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/brand.css"],
      // The landing page declares `color-scheme: light` and paints ~60 colours
      // that are not driven by its CSS variables, so it has no dark palette to
      // match. Rather than let a reader cross from a cream landing page into a
      // dark docs site, the docs commit to the same light identity: SiteTitle
      // reuses the landing brand markup, and ThemeSelect is removed because a
      // toggle that cannot change anything is worse than no toggle.
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Maximumsoft-Co-LTD/claude-foundation",
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/Maximumsoft-Co-LTD/claude-foundation/edit/main/website/docs/",
      },
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        th: { label: "ไทย", lang: "th" },
      },
      // A page listed here must exist in BOTH locales. Starlight falls back to
      // the default locale for a missing translation, which silently strands a
      // Thai reader on an English page — the fallback is a safety net, not a
      // licence to ship half a locale.
      // Ordered by what a page depends on, not by how deep it is. "What
      // Foundation writes" sits in Get started because it names the files that
      // appear the moment you run the quickstart, and the loop and evidence
      // pages then use that vocabulary — packet, receipt, vault — without
      // reintroducing it. "Human approval" sits last in Evidence for the
      // mirror-image reason: acceptance and review ARE evidence capabilities,
      // and the page leans on receipts and the change loop, so it cannot be
      // read before them.
      sidebar: [
        {
          label: "Get started",
          translations: { th: "เริ่มต้น" },
          items: [
            { slug: "index", label: "What is Foundation?", translations: { th: "Foundation คืออะไร" } },
            { slug: "install", label: "Install", translations: { th: "ติดตั้ง" } },
            { slug: "quickstart", label: "Quickstart", translations: { th: "เริ่มใช้งาน" } },
            { slug: "artifacts", label: "What Foundation writes", translations: { th: "Foundation เขียนอะไรบ้าง" } },
          ],
        },
        {
          label: "The change loop",
          translations: { th: "วงจรการเปลี่ยนแปลง" },
          items: [
            { slug: "loop", label: "Overview", translations: { th: "ภาพรวม" } },
            { slug: "loop/investigate", label: "/investigate" },
            { slug: "loop/change", label: "/change" },
            { slug: "loop/build", label: "/build" },
            { slug: "loop/prove", label: "/prove" },
            { slug: "loop/land", label: "/land" },
          ],
        },
        {
          label: "Evidence",
          translations: { th: "หลักฐาน" },
          items: [
            { slug: "evidence/claims", label: "Claims and capabilities", translations: { th: "Claim และ capability" } },
            { slug: "evidence/adapters", label: "Adapters and wiring", translations: { th: "Adapter และการต่อสาย" } },
            { slug: "evidence/receipts", label: "Receipts and staleness", translations: { th: "Receipt และความ stale" } },
            { slug: "approval", label: "Human approval", translations: { th: "การอนุมัติโดยคน" } },
          ],
        },
        {
          label: "Reference",
          translations: { th: "อ้างอิง" },
          items: [
            { slug: "cli", label: "CLI reference", translations: { th: "คำสั่ง CLI" } },
          ],
        },
      ],
    }),
  ],
});

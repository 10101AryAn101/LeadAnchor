# LeadAnchor owner app: UI research and design brief

- **Date:** 2026-10-28
- **Scope:** the owner-facing mobile-first PWA (dashboard, lead board, lead detail, calls log, settings and integrations) and the public no-login request form customers open from a text.
- **Fixed stack:** Next.js 16.4.3 (App Router, Turbopack, `cacheComponents`), React 19.3, Tailwind CSS 4.3, shadcn/ui, TypeScript. Licences must allow a closed-source product the client owns: MIT, Apache, ISC, BSD and OFL are fine; AGPL and GPL are for inspiration only.
- **How this was checked:**
  - Versions, licences, peer dependencies and publish dates come from the npm registry and the GitHub API, read on 2026-10-28.
  - shadcn behaviour comes from reading `shadcn-ui/ui` source on `main`.
  - Font OpenType features were parsed from the `google/fonts` TTFs. Font availability was checked in the installed `next@16.4.3`.
  - Every colour pair below was computed (WCAG 2.x contrast and sRGB gamut). Chart palettes were run through a colour-vision-deficiency validator.

---

## 0. Decisions at a glance

| Area | Decision |
|---|---|
| Component base | shadcn/ui CLI v4 with the **Base UI** flavour (`init -b base`), the **Vega** style, the **Stone** base colour and **Tabler** icons. Override tokens and sizes as described in §3–4 |
| Sheets and drawers | shadcn `drawer` on Base UI (`@base-ui/react/drawer`). **Remove `vaul`** |
| Kanban | Dice UI Kanban (Base UI variant) on `@dnd-kit/core` 6 and `@dnd-kit/sortable` 10. Drag only on screens ≥768px. Every card has a "Move to…" sheet |
| Charts | shadcn `chart` (Recharts 3), not Tremor |
| Motion | `motion` 14 (`motion/react`), plus `@number-flow/react` for the money figure |
| Type | **Archivo** for headings and money, **Atkinson Hyperlegible Next** for all UI text. Both are OFL and loaded with `next/font/google` |
| Colour | Warm stone neutrals. **Anchor green** `oklch(0.48 0.10 163)` is the primary. **High-vis amber** `oklch(0.82 0.15 75)` means "someone is waiting on you". Red is only for failures and STOP |
| Mobile shell | Four-tab bottom bar below 1024px and a sidebar at 1024px and up. Sheets instead of modals. Sticky bottom action bars. Safe-area aware |

---

## 1. Libraries

### 1.1 Verdict on what is already installed (`apps/web/package.json`)

| Installed | Verdict | Why |
|---|---|---|
| `next` 16.4.3, `react` 19.3.0, `tailwindcss` 4 with `@tailwindcss/turbopack` 4.3.3 | Keep | Current. React 19.3.1 is a patch release. |
| `@tanstack/react-query` ^5.105 | Keep | Add `@tanstack/react-query-devtools` as a dev dependency. |
| `zod` ^4.6.7, `react-hook-form` ^7.91, `@hookform/resolvers` ^6.0.2 | Keep | Resolvers 6 peers on zod ^3.25 or ^4. RHF 8 is still beta. Use the shadcn `Field` component for layout. |
| `sonner` ^2.0.8 | Keep | Maintained (2.0.8, Aug 2026). shadcn ships a `sonner` wrapper for Base UI. Do not also add the shadcn Base UI `toast`; pick one. |
| **`vaul` ^1.1.2** | **Remove** | Its [README](https://github.com/emilkowalski/vaul) says the project is unmaintained, and the last release was Dec 2024. Only shadcn's Radix drawer still wraps it. The Base UI drawer uses `@base-ui/react/drawer`. |
| `cmdk` ^1.1.1 | Keep | Stable (Mar 2025) and used by shadcn `command`. The repo moved to `dip/cmdk` and is low-activity, which is fine for a search sheet. |
| `motion` ^14.7.1 | Keep | Import from `motion/react`. Use `LazyMotion` with `domAnimation`. |
| `recharts` ^3.10.1 | Keep | The shadcn `chart` registry item pins `recharts@3.8.0`. After `shadcn add chart`, check it did not downgrade, then type-check. |
| `@dnd-kit/core` ^6.3.1, `sortable` ^10, `utilities` ^3.2.2 | Keep | Dice UI, ReUI, Kibo UI and the Next 16 dashboard starter all build on these. The classic packages have been frozen since Dec 2024 but are stable. |
| `date-fns` ^4.4.0 | Keep | Add `@date-fns/tz`. Base UI 1.9 also peers on both. |
| `next-themes` ^0.4.6 | Keep | Stable. The shadcn `sonner` wrapper needs it. |
| **`lucide-react` ^1.63** | **Swap (recommended)** to `@tabler/icons-react` | Lucide has no filled variants, which you need for the active tab, and Lucide-only icon sets are a listed "default shadcn" tell ([Sailop](https://sailop.com/blog/detect-ai-generated-site-30-seconds-21-signs-2026)). Tabler (MIT) has 1,054 filled icons, including `home`, `layout-kanban`, `phone`, `message`, `settings`, `bell` and `microphone`. This is optional: keeping Lucide with a pill-shaped active indicator also works. |
| `clsx` and `tailwind-merge` | Optional swap to `cn` | Since Sep 2026, shadcn components import `cn` from the [`cn` package](https://ui.shadcn.com/docs/changelog). `shadcn init` adds it, and `npx shadcn@latest migrate cn` removes the old pair. |
| `class-variance-authority` 0.7.1 | Keep | shadcn dependency. |

### 1.2 Add

| Purpose | Package | Version | Licence | Reason |
|---|---|---|---|---|
| Primitives (added by `shadcn init -b base`) | `@base-ui/react` | 1.9.0 | MIT | The shadcn default since Jul 2026. v1.0 has been stable since 11 Dec 2025, with monthly minor releases. Provides Drawer, Toast, Combobox and more. |
| shadcn CLI and CSS (added by init) | `shadcn` (dev), `cn`, `tw-animate-css` | 4.23.0 / 0.5.0 / 1.4.0 | MIT | Init writes the `@import "shadcn/tailwind.css"` and `tw-animate-css` lines. |
| Icons | `@tabler/icons-react` | 3.50.0 | MIT | Outline icons by default and filled icons for the active state. Supported by `shadcn create`. |
| Kanban extras (pulled in by Dice UI) | `@dnd-kit/modifiers`, `@base-ui/utils` | 9.0.0 / 0.5.0 | MIT | Dependencies of the Dice UI Kanban. |
| Time zones | `@date-fns/tz` | 1.5.0 | MIT | Shows times in the business's own zone with `TZDate`. |
| Animated money | `@number-flow/react` | 0.6.2 | MIT | Takes `Intl` currency format options and respects reduced motion by default ([docs](https://number-flow.barvian.me)). |
| URL state | `nuqs` | 2.10.2 | MIT | Keeps `?stage=quoted`, filters and tabs through back/forward and push-notification deep links. |
| Phone input | `libphonenumber-js` (already in `@leadanchor/contracts`) | 1.13.15 | MIT | Add an `AsYouType` helper next to `formatPhone`/`toE164` in contracts instead of adding a second direct dependency. |
| Devtools | `@tanstack/react-query-devtools` (dev) | 5.105.0 | MIT | |
| Offline PWA (phase 2) | `serwist`, `@serwist/turbopack` | 9.5.13 | MIT | The [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps) (updated 2026-07-30) recommends Serwist for offline caching. This repo builds with Turbopack. |
| Optional | `@tanstack/react-virtual` | 3.14.23 | MIT | Only if the calls log grows past a few hundred rows. |

`web-push` (MPL-2.0), the library used in the Next.js push example, is fine as an unmodified server dependency.

### 1.3 Commands (not run; copy them when implementing)

```bash
# From the repo root. Base UI is the default; -b base makes it explicit.
pnpm dlx shadcn@latest init -c apps/web -b base        # choose: style Vega, base colour Stone, icons Tabler
pnpm dlx shadcn@latest add -c apps/web button input field item empty drawer sheet dialog tabs \
  toggle-group badge avatar skeleton spinner sonner command chart input-group
pnpm dlx shadcn@latest add -c apps/web @diceui/kanban @diceui/timeline @diceui/media-player @diceui/file-upload
pnpm --filter @leadanchor/web add @date-fns/tz @number-flow/react nuqs
pnpm --filter @leadanchor/web add -D @tanstack/react-query-devtools
pnpm --filter @leadanchor/web remove vaul               # and lucide-react, once Tabler is in
```

Do not use `init --defaults`, because it selects the **Nova** preset. Nova uses 32px controls and is built for desktop density.

### 1.4 Base UI or Radix: choose Base UI for this app

- **The ecosystem has moved.** On 2026-07-02 shadcn made Base UI the default for new projects and recommends it for new work. Radix is still supported and not deprecated ([changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)). Base UI 1.0 shipped on 2025-12-11 and 1.9.0 on 2026-10-09 ([releases](https://github.com/mui/base-ui/releases)). It now has more weekly downloads (~17M) than the unified `radix-ui` package (~16M).
- **Sheets settle it.** This app lives in bottom sheets.
  - The shadcn Radix drawer wraps `vaul`, which is unmaintained.
  - The Base UI drawer has swipe-to-dismiss, snap points, nested drawers, swipe areas that open it from an edge, and a `VirtualKeyboardProvider` that keeps focused fields visible above the keyboard ([Base UI Drawer](https://base-ui.com/react/components/drawer)).
- **Registries support it.** Dice UI, ReUI and coss ui ship Base UI variants, and the shadcn CLI auto-detects your library when it pulls registry components ([Dec 2025 changelog](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)).
- **Caveat.** Kibo UI and some older registries are Radix-only. Their kanban and timeline code is mostly plain `div`s plus dnd-kit, so adapting it is cheap.

### 1.5 Kanban drag and drop

| Option | Status (Oct 2026) | Touch | Verdict |
|---|---|---|---|
| **`@dnd-kit/core` 6.3.1 + `sortable` 10, through [Dice UI Kanban](https://diceui.com/docs/components/kanban)** (MIT) | Stable. Last release Dec 2024, but the repo is active. Dice UI commits touched kanban and sortable on 2026-10-18. | `TouchSensor` with a delay; keyboard pick-up, move and drop | **Use** |
| [`@dnd-kit/react`](https://dndkit.com/react/quickstart) 0.5.1 | The new API. Actively released (2026-10-15) but pre-1.0. | A single `PointerSensor`; the docs suggest a 250ms delay with 5px tolerance for touch ([sensors](https://dndkit.com/react/guides/sensors)) | Migrate once it reaches 1.0. Only the board component needs to change. |
| [Pragmatic drag and drop](https://github.com/atlassian/pragmatic-drag-and-drop) 4.0.0 (Apache-2.0) | Maintained by Atlassian; powers Trello, Jira and Confluence | Uses native HTML drag and drop, so the OS long-press decides when a drag starts | Alternative. More styling work. |
| `@hello-pangea/dnd` 18.0.1 | Last release Feb 2025 | Works | Skip |
| `react-beautiful-dnd` | Deprecated on npm | | Avoid |
| [Kibo UI Kanban](https://www.kibo-ui.com/components/kanban) (MIT) | Repo moved to `shadcnblocks/kibo`. No meaningful kanban change since Oct 2025. | dnd-kit with `tunnel-rat` | Reference only |

### 1.6 Charts: use shadcn chart, not Tremor

shadcn `chart` is a thin Recharts 3 wrapper that takes colours from CSS variables and handles dark mode ([charts](https://ui.shadcn.com/charts)).

Tremor has gone quiet since the Vercel deal:

- `@tremor/react` 3.18.7 was last published 2025-01-13 and peers on React ^18 only.
- The copy-paste Tremor Raw repo got its Tailwind v4 update in Apr 2025 and only CI cleanup since then ([repo](https://github.com/tremorlabs/tremor)).
- Treat Tremor and Tremor Blocks as layout references only.

The mobile dashboard needs at most two small charts anyway.

### 1.7 Avoid

- `vaul`
- `@tremor/react`
- `react-beautiful-dnd`
- `@base-ui-components/react` (renamed to `@base-ui/react`)
- `tailwindcss-animate` (replaced by `tw-animate-css`)
- the `framer-motion` package name (same code as `motion`; use `motion`)
- `@remixicon/react`, which uses the custom "Remix Icon License 1.0" rather than an OSI licence
- Magic UI effects inside the app
- any code from AGPL repos

---

## 2. Reference repos and blocks

| Resource | Licence | Borrow | Watch out |
|---|---|---|---|
| [shadcn/ui blocks](https://ui.shadcn.com/blocks): `dashboard-01`, `sidebar-07`, `login-0x` (Base UI versions since Feb 2026) | MIT | App shell, collapsible sidebar, container-query cards, chart wrapper, data table | `dashboard-01`'s `SectionCards` is four identical cards with a `from-primary/5` gradient wash, a shadow and trend badges. That is the generic look; don't ship it as-is. |
| shadcn components ([Base UI docs](https://ui.shadcn.com/docs/components/base/drawer)): Drawer, Item, Empty, Field, Input Group, Spinner, Sonner, Chart, Command, and the June 2026 chat set (Bubble, Message, Message Scroller, Attachment) | MIT | Most of the app. Use the chat set for the SMS thread. | Every style defaults to 32–36px controls. Raise them to 44px (§4.2). |
| [Dice UI](https://diceui.com) (`sadmann7/diceui`) | MIT | Kanban, Timeline, Media Player (voicemail), File Upload, Phone Input, Responsive Dialog (dialog on desktop, drawer on mobile), Stat, Status, Relative Time Card | Active (Oct 2026). Has Base UI and Radix variants. |
| [ReUI](https://reui.io) (`keenthemes/reui`) | MIT | Kanban, Timeline, Sortable (Base UI and Radix), 1000+ patterns | v2.8.1, released 2026-10-16 |
| [coss ui](https://coss.com/ui) (`cosscom/ui`, formerly Origin UI) | **Mixed:** `apps/ui` and `apps/origin` are MIT; the rest of the repo is AGPL-3.0 | Chat bubbles, delivery indicators, date pills, unread divider, segmented control, Base UI drawer, Empty | Install only through its registry. Never copy from `packages/ui` or other AGPL directories. |
| [Kibo UI](https://www.kibo-ui.com) (`shadcnblocks/kibo`) | MIT | Kanban and dropzone reference | Low activity |
| [next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) | MIT | Proof that this exact stack composes: Next 16.4, React 19.3, Base UI 1.9, TanStack Query SSR prefetch, nuqs, a dnd-kit kanban with zustand, Recharts 3.10, Motion 14 | Ignore the Clerk and Sentry parts. |
| [shadcn-admin](https://github.com/satnaing/shadcn-admin) | MIT | Settings and notification form layouts, global search | Built on Vite, not Next |
| [Tremor Raw](https://tremor.so) and [Tremor Blocks](https://blocks.tremor.so) | Apache-2.0 / MIT | KPI tile and chart layout references | Dormant |
| [Magic UI](https://magicui.design) | MIT | The marketing site at most | Border-beam, shine-border, sparkles-text, aurora-text and meteors are AI tells. |
| [tweakcn](https://tweakcn.com) | Apache-2.0 | Editing OKLCH tokens visually and exporting shadcn variables | |
| [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) | MIT | QA checklist (quoted throughout §4) | |
| [Harmonizer](https://evilmartians.com/opensource/harmonizer) (Evil Martians) | No licence file | Checking OKLCH ramps (APCA). Use the tool; don't copy its code. | |
| **Inspiration only:** [Twenty](https://github.com/twentyhq/twenty) CRM, [Midday](https://github.com/midday-ai/midday) and [Dub](https://github.com/dubinc/dub) | AGPL-3.0 (Twenty's `twenty-ui` is MIT but Emotion-based) | Look at Twenty's timeline and kanban, Midday's money dashboard and receipt matching, and Dub's KPI tiles | Never copy their code. |

---

## 3. Visual direction: "work order, not war room"

The app should feel like a well-made job ticket: sturdy, legible, warm and quiet. One thing on each screen is loud: the money or the next person to call. Everything else steps back.

### 3.1 The "AI-generated" tells we are designing against

| Tell | Where it is documented | LeadAnchor rule |
|---|---|---|
| Indigo or violet primary; purple-to-blue gradients | [Adam Wathan apologising for `bg-indigo-500`](https://x.com/adamwathan/status/1953510802159219096) (Aug 2025); [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website); [Claude blog](https://claude.com/blog/improving-frontend-design-through-skills); [SCALR #1](https://scalr.sg/blog/20-signs-a-website-was-made-by-ai/); [Sailop #1 and #6](https://sailop.com/blog/detect-ai-generated-site-30-seconds-21-signs-2026) | Anchor green primary. No gradients on surfaces or text. |
| Inter, Geist or one default font everywhere | Claude blog; [925studios](https://www.925studios.co/blog/ai-slop-web-design-guide); SCALR #4; Sailop #2 | Archivo plus Atkinson Hyperlegible Next (§3.3) |
| Glassmorphism and frosted cards | SCALR #6; [Gabriel Hidalgo](https://www.gabrielhidalgo.design/blog/make-website-look-less-ai-generated); [smoothui](https://smoothui.dev/blog/ai-design-slop) | Solid surfaces. Sticky bars may be at most 8% translucent. |
| Emoji in headings; sparkle "New" pills | SCALR #3 and #9; Sailop #5 | No emoji in UI chrome. All icons come from one set. |
| Identical rounded cards with one radius, a soft grey shadow and gradient washes | The [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) (its "SaaS-card kit"); Sailop #3; Hidalgo; shadcn `dashboard-01` | Radius follows hierarchy. Borders instead of shadows at rest. One hero figure per screen. |
| Gradient headline text; coloured left-border "alert" cards | SCALR #2 and #5 | Solid ink. Status shown as an icon plus a label. |
| ALL-CAPS eyebrows, middle-dot meta strings, monospace data labels, "→" on buttons | Anthropic skill | Sentence-case labels, spaced icon-led meta, the sans font's tabular figures, chevrons only on navigation rows |
| Fade-and-rise on every section, hover bounce, cursor glow | Anthropic skill; SCALR #12 and #13; Sailop #17 | Motion only answers something the user did (§3.6). |
| Unmodified shadcn classes, raw Tailwind greys, Lucide-only icons | Sailop #18–20. shadcn itself wrote that "all apps started looking the same" ([Dec 2025](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)). | Semantic tokens only, restyled components, Tabler icons with filled states |
| Low-contrast dark mode | SCALR #7 | A validated dark token set (§3.4) |
| Cream background with serif and terracotta; near-black with acid green | Anthropic skill | Near-white stone at chroma 0.003 (not cream). Deep green, never lime. |

### 3.2 Principles

1. **One job per screen.** Chrome recedes unless it is central to the task, and dividers orient without drawing attention ([Linear, Mar 2026](https://linear.app/now/behind-the-latest-design-refresh)).
2. **Colour carries meaning.** Green means go, money or won. Amber means someone is waiting on you. Red means failed or stopped. Everything else is neutral.
3. **Built for a thumb, in sunlight, in ten seconds.** Optimise for fewer minutes in the app ([ServiceTitan, Mar 2026](https://www.servicetitan.com/blog/success-story-goettl-field-mobile-app)).
4. **Honest and specific.** Show the real business name, the photos the customer actually sent, and label estimates as estimates ([Stripe labels its home charts as estimates](https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights)).

### 3.3 Typography

| Font | Role | Licence | Axes | Verified features | Why |
|---|---|---|---|---|---|
| **Archivo** (Omnibus-Type) | Screen titles, hero money figure, KPI values | OFL-1.1 | wght 100–900, **wdth 62–125** | `tnum lnum zero case frac` | A grotesque with late-19th-century American roots ([description](https://github.com/google/fonts/tree/main/ofl/archivo)). At semi-expanded width it reads like van livery or a job sign, which suits trades and works for salons too. |
| **Atkinson Hyperlegible Next** (Braille Institute, 2025) | All UI text, names, phone numbers, inputs | OFL-1.1 | wght 200–800 | `tnum pnum case frac` | Designed to tell look-alike characters apart (1/l/I, 0/O, B/8) ([Braille Institute](https://www.brailleinstitute.org/freefont/)). That matters for phone numbers and dollar amounts read in a van. |

- Both fonts exist in the installed `next@16.4.3` font data, as the `Archivo` (with `wdth`) and `Atkinson_Hyperlegible_Next` exports.
- Rejected for lacking `tnum`: Hanken Grotesk, Wix Madefor Text, Rethink Sans and Inclusive Sans.
- Rejected as defaults or tells: Inter, Geist, DM Sans, Manrope, Space Grotesk, Outfit and Instrument Sans/Serif (most appear in `shadcn create`'s font list).
- Single-family fallback: **Mona Sans** (OFL, wdth 75–125, `tnum`).

```tsx
// apps/web/src/app/layout.tsx
import { Archivo, Atkinson_Hyperlegible_Next } from "next/font/google";

const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const sans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson", display: "swap" });
// <html lang="en" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
```

```css
/* globals.css */
@theme inline {
  --font-sans: var(--font-atkinson), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
}
/* usage: class="font-display font-semibold font-stretch-semi-expanded" (Tailwind v4: semi-expanded = 112.5%) */
```

**Type scale (mobile; desktop in brackets)**

| Role | Font, weight and width | Size / line height |
|---|---|---|
| Hero figure (one per view) | Archivo 600, 112.5% | 48/48 (56), tracking −0.01em |
| Screen title | Archivo 650, 112.5% | 24/30 (28/34) |
| Section title | Atkinson 700 | 17/24 |
| Card title / person name | Atkinson 600 | 17/22 |
| Body, inputs, buttons | Atkinson 400 / 600 | **16**/24. Inputs must be 16px or larger, or iOS zooms on focus. |
| Meta and secondary | Atkinson 400, muted | 15/20. Never below 14px. |
| Chip or badge only | Atkinson 500 | 13/16, sentence case |

**Numbers and money**

- **Use `tabular-nums`** for anything that aligns or updates: amounts in lists and column headers, call durations, list timestamps, "waiting 12 min" timers, phone numbers in lists, and any value animated by NumberFlow ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric); [Vercel guideline](https://vercel.com/design/guidelines)).
- **Leave the single static hero figure proportional.** Tabular digits look loose at 48px.
- **Format money with `Intl`.** Use `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })` for "$4,820". Use `notation: "compact"` from $10k up ("$12.9K"). Show cents only on invoices.
- **Format phone numbers with the contracts helpers.** Display with `formatPhone()` from `@leadanchor/contracts`, which gives "(512) 555-0142". Dial with `tel:` and the E.164 number.

### 3.4 Colour (OKLCH tokens)

- **Why OKLCH.** It has perceptual lightness, so changing hue does not break contrast. Tailwind v4's palette and shadcn themes already use it ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [Tailwind colours](https://tailwindcss.com/docs/colors)).
- **Prior art.** Linear generates whole themes from three inputs (base, accent and contrast) in a perceptual space ([2024](https://linear.app/now/how-we-redesigned-the-linear-ui)), and moved to warmer, less saturated greys in 2026. Stripe builds its palettes by contrast ([accessible colour systems](https://stripe.com/blog/accessible-color-systems)).
- **Rule.** Components use semantic tokens only. No `bg-indigo-500`, no `text-gray-600`.

| Token | Light | Dark | Use and verified contrast (light / dark) |
|---|---|---|---|
| `background` | `oklch(0.985 0.003 85)` #fbfaf8 | `oklch(0.17 0.006 60)` #110f0d | Page |
| `card`, `popover` | `oklch(1 0 0)` | `oklch(0.205 0.007 60)` #1a1614 | Surfaces. Elevation is a lighter surface, not a shadow. |
| `muted`, `secondary`, `accent` | `oklch(0.962 0.004 85)` #f4f2ef | `oklch(0.245 0.008 60)` #23201d | Fills and hovers |
| `border` | `oklch(0.912 0.005 85)` | `oklch(0.29 0.008 60)` | Structure only |
| `input` | `oklch(0.64 0.01 75)` #908b86 | `oklch(0.52 0.01 60)` | Control outlines. 3.2:1 / 3.5:1 meets [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). |
| `foreground` | `oklch(0.205 0.008 60)` | `oklch(0.965 0.004 85)` | Text: 17.2:1 / 17.3:1 |
| `muted-foreground` | `oklch(0.49 0.012 65)` #655f59 | `oklch(0.72 0.012 70)` | Secondary text: 6.0:1 / 7.7:1 |
| **`primary`** (Anchor green) | **`oklch(0.48 0.10 163)`** #0c6f4d | **`oklch(0.74 0.13 163)`** #4cc493 | Primary actions, Call, Won, recovered money |
| `primary-foreground` | `oklch(0.99 0.006 163)` | `oklch(0.19 0.04 163)` | On primary: 6.0:1 / 8.4:1 |
| `primary-subtle` / `-foreground` | `oklch(0.955 0.03 163)` / `oklch(0.38 0.08 163)` | `oklch(0.27 0.05 163)` / `oklch(0.84 0.10 163)` | Selected tab, Won chip: 8.5:1 / 9.4:1 |
| `ring` | `oklch(0.58 0.12 163)` | `oklch(0.70 0.13 163)` | Focus: 3.9:1 / 7.6:1 against the background |
| **`signal`** (high-vis amber) | **`oklch(0.82 0.15 75)`** #fcb442 | `oklch(0.83 0.15 78)` | "Waiting on you" fills, always with dark text |
| `signal-foreground` | `oklch(0.27 0.05 55)` | `oklch(0.25 0.05 55)` | 8.6:1 / 9.4:1 |
| `signal-subtle` / `-strong` | `oklch(0.965 0.035 85)` / `oklch(0.50 0.12 55)` | `oklch(0.28 0.05 70)` / `oklch(0.82 0.14 78)` | Amber text on its tint: 5.6:1 / 8.3:1 |
| `destructive` | `oklch(0.55 0.20 27)` #cc2827 | `oklch(0.57 0.20 27)` | Failed send, STOP, delete. White text: 5.4:1 / 4.9:1. |
| `destructive-subtle` / `-strong` | `oklch(0.96 0.017 25)` / `oklch(0.50 0.19 27)` | `oklch(0.27 0.06 27)` / `oklch(0.74 0.14 25)` | 5.9:1 / 6.3:1 |
| `info-subtle` / `-strong` | `oklch(0.955 0.02 245)` / `oklch(0.50 0.10 245)` | `oklch(0.27 0.04 245)` / `oklch(0.76 0.09 245)` | Auto-summary and system notes: 5.2:1 / 7.1:1 |

**Charts and stages** (all validated)

- **Status pair.** `chart-1`, recovered or won, is `oklch(0.48 0.10 163)` (dark `oklch(0.64 0.13 163)`). `chart-2`, open or waiting, is `oklch(0.66 0.14 62)` (dark `oklch(0.67 0.13 70)`). The pair passes CVD separation, normal-vision separation and 3:1 against the surface in both modes.
- **Comparison series.** `chart-3`, the comparison period, is the neutral `oklch(0.64 0.01 70)` (dark `oklch(0.55 0.01 70)`). Never place it next to amber without direct labels.
- **Stages are ordinal, so they use one green ramp, never a rainbow.** New → Won, light: `oklch(0.76 0.07 163)`, `0.67 0.085`, `0.59 0.095`, `0.52 0.10`, `0.46 0.095`. Dark: `oklch(0.42 0.07 163)`, `0.50 0.09`, `0.58 0.11`, `0.66 0.12`, `0.76 0.12`. Lost is neutral grey, not red.

**Usage rules**

- Only one hue is ever "brand". Amber appears only when a human is waiting. Red appears only for failures, STOP and destructive actions.
- Status always pairs an icon with a word.
- Text in charts uses text tokens, never the series colour.
- The money figure is foreground ink, not green. The green delta arrow carries the good news.
- If a competitor's green clashes, rotate the hue to petrol (`oklch(0.48 0.085 215)`, 6.3:1). L and C stay the same, which is the point of OKLCH.

```css
/* apps/web/src/app/globals.css (after shadcn init; tokens only) */
@custom-variant dark (&:is(.dark *));
@custom-variant standalone (@media (display-mode: standalone));
@custom-variant coarse (@media (pointer: coarse));

:root {
  --radius: 0.75rem;
  --background: oklch(0.985 0.003 85);  --foreground: oklch(0.205 0.008 60);
  --card: oklch(1 0 0);                 --card-foreground: oklch(0.205 0.008 60);
  --popover: oklch(1 0 0);              --popover-foreground: oklch(0.205 0.008 60);
  --primary: oklch(0.48 0.10 163);      --primary-foreground: oklch(0.99 0.006 163);
  --secondary: oklch(0.962 0.004 85);   --secondary-foreground: oklch(0.205 0.008 60);
  --muted: oklch(0.962 0.004 85);       --muted-foreground: oklch(0.49 0.012 65);
  --accent: oklch(0.962 0.004 85);      --accent-foreground: oklch(0.205 0.008 60);
  --destructive: oklch(0.55 0.20 27);
  --border: oklch(0.912 0.005 85);      --input: oklch(0.64 0.01 75);   --ring: oklch(0.58 0.12 163);
  --primary-subtle: oklch(0.955 0.03 163);  --primary-subtle-foreground: oklch(0.38 0.08 163);
  --signal: oklch(0.82 0.15 75);        --signal-foreground: oklch(0.27 0.05 55);
  --signal-subtle: oklch(0.965 0.035 85); --signal-strong: oklch(0.50 0.12 55);
  --destructive-subtle: oklch(0.96 0.017 25); --destructive-strong: oklch(0.50 0.19 27);
  --info-subtle: oklch(0.955 0.02 245); --info-strong: oklch(0.50 0.10 245);
  --chart-1: oklch(0.48 0.10 163); --chart-2: oklch(0.66 0.14 62); --chart-3: oklch(0.64 0.01 70);
  --sidebar: oklch(0.97 0.004 85); /* one step dimmer than the page, after Linear */
}
.dark {
  --background: oklch(0.17 0.006 60);   --foreground: oklch(0.965 0.004 85);
  --card: oklch(0.205 0.007 60);        --card-foreground: oklch(0.965 0.004 85);
  --popover: oklch(0.205 0.007 60);     --popover-foreground: oklch(0.965 0.004 85);
  --primary: oklch(0.74 0.13 163);      --primary-foreground: oklch(0.19 0.04 163);
  --secondary: oklch(0.245 0.008 60);   --secondary-foreground: oklch(0.965 0.004 85);
  --muted: oklch(0.245 0.008 60);       --muted-foreground: oklch(0.72 0.012 70);
  --accent: oklch(0.245 0.008 60);      --accent-foreground: oklch(0.965 0.004 85);
  --destructive: oklch(0.57 0.20 27);
  --border: oklch(0.29 0.008 60);       --input: oklch(0.52 0.01 60);   --ring: oklch(0.70 0.13 163);
  --primary-subtle: oklch(0.27 0.05 163);   --primary-subtle-foreground: oklch(0.84 0.10 163);
  --signal: oklch(0.83 0.15 78);        --signal-foreground: oklch(0.25 0.05 55);
  --signal-subtle: oklch(0.28 0.05 70); --signal-strong: oklch(0.82 0.14 78);
  --destructive-subtle: oklch(0.27 0.06 27); --destructive-strong: oklch(0.74 0.14 25);
  --info-subtle: oklch(0.27 0.04 245);  --info-strong: oklch(0.76 0.09 245);
  --chart-1: oklch(0.64 0.13 163); --chart-2: oklch(0.67 0.13 70); --chart-3: oklch(0.55 0.01 70);
  --sidebar: oklch(0.15 0.006 60);
}
@theme inline {
  --color-signal: var(--signal); --color-signal-foreground: var(--signal-foreground);
  --color-signal-subtle: var(--signal-subtle); --color-signal-strong: var(--signal-strong);
  --color-primary-subtle: var(--primary-subtle); --color-primary-subtle-foreground: var(--primary-subtle-foreground);
  --color-destructive-subtle: var(--destructive-subtle); --color-destructive-strong: var(--destructive-strong);
  --color-info-subtle: var(--info-subtle); --color-info-strong: var(--info-strong);
  /* shadcn init already maps background, primary, chart-* and the rest */
}
```

### 3.5 Shape, borders, elevation and density

- **Radius follows hierarchy.**
  - Controls and inputs: 10px.
  - Cards and list groups: 14px.
  - Sheets: 20px on the top corners.
  - Chips and avatars: fully round.
  - Nested radius = outer radius − padding.
  - Never use one radius everywhere.
- **Borders, not shadows, at rest.** Use a 1px `border` for structure and the stronger `input` token for anything tappable. Only floating layers get a shadow: sheets, popovers, toasts and the dragged card. Use at most two elevation levels. In dark mode, elevation is a lighter surface.
- **No translucency.** Avoid blur and glass. If a sticky bar must be translucent, keep it at least 92% opaque.
- **Density targets (mobile):**
  - Body text 16px.
  - List rows at least 56px (one line) or 72px (two lines).
  - Card padding 16px.
  - Spacing scale 4/8/12/16/24/32.
  - At most two meta lines per card.
  - At most one primary and two secondary actions per card.
  - On the dashboard: one hero, two supporting tiles and one action list.
  - On phones, lists replace tables. Desktop can tighten, but keep the same structure.

### 3.6 Motion

- **Animate only what the user caused or must notice:**
  - a card moving stage (Motion `layout`)
  - a new lead arriving (slides in; an amber tint fades over about 1.5s)
  - sheets opening and closing
  - toasts
  - the money figure changing (NumberFlow)
- **Timing** ([NN/g](https://www.nngroup.com/articles/animation-duration/); [Emil Kowalski](https://emilkowal.ski/ui/great-animations)):
  - About 100–150ms for press and toggle feedback.
  - 200–250ms for a sheet to enter; exits slightly faster.
  - Nothing over 300ms.
  - Ease-out for entrances.
  - Springs with no bounce for drags and sheets.
  - Everything must be interruptible.
- **Never:** page-load staggers, scroll reveals, hover bounces, parallax, or shimmer sweeps.
- **Reduced motion.** Wrap the app in `<MotionConfig reducedMotion="user">`, which turns off transform and layout animation but keeps fades ([Motion docs](https://motion.dev/docs/react-accessibility)). Use Tailwind `motion-safe:` for CSS animation.
- **Haptics.** `navigator.vibrate` does not exist on iOS Safari ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)), so treat it as an Android-only bonus.

### 3.7 Empty states

Follow NN/g's three jobs: state the system status, teach in context, and give a direct path ([NN/g](https://www.nngroup.com/articles/empty-state-interface-design/)). Use the shadcn `Empty` component with an icon, one sentence and one action. No stock illustrations.

- **Board:** "No leads yet. Missed calls show up here within a minute." Action: **Place a test call**.
- **Calls:** show the forwarding status of their LeadAnchor number. Action: **How to forward your line**.
- **Dashboard before any data:** "$0 recovered so far. Here's how we count it."
- Never show "No results" while data is still loading.

### 3.8 Loading, skeletons and optimistic UI

- **Match the indicator to the wait** ([NN/g](https://www.nngroup.com/articles/skeleton-screens/)):
  - Under 1s: show nothing.
  - Full-page loads: a skeleton that mirrors the final layout exactly.
  - One module loading: a spinner.
  - Uploads: a progress bar.
- **Avoid flicker.** Delay the indicator 150–300ms and keep it visible at least 300–500ms ([Vercel guidelines](https://vercel.com/design/guidelines)).
- **Lean on Cache Components.** With `cacheComponents` on, the static shell renders at once. Put skeletons only in the `Suspense` fallbacks that wrap dynamic data.
- **Mutations are optimistic.** Stage moves, marking won or lost, and sending a text update the TanStack Query cache in `onMutate` and roll back `onError` ([guide](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)), followed by a Sonner toast with **Undo**.

### 3.9 Dark mode

- **Setup.** Use `next-themes` with `attribute="class"` and `defaultTheme="system"`, and `disableTransitionOnChange` ([shadcn guide](https://ui.shadcn.com/docs/dark-mode/next)).
- **Tokens.** Dark tokens are chosen and validated, not inverted.
- **Surfaces.** Higher surfaces are lighter, and chroma drops slightly.
- **Browser UI.** Set `color-scheme: dark` on `html`, and give `themeColor` one value per scheme (§4.7).
- **Default.** Light, because it reads best in sun, with the system setting respected.

### 3.10 Icons and copy

- **Icons.**
  - Tabler, 24px, stroke 1.75–2.
  - Outline by default; filled only for the active tab.
  - Never mix icon sets.
  - No emoji anywhere in the UI.
- **Copy.**
  - Sentence case everywhere.
  - Buttons are verbs with objects: "Call Maria", "Text back", "Mark as won".
  - Relative times ("12 min ago") with the absolute time on tap.
  - Use the owner's words: job, quote, customer. Not pipeline, deal or contact.
- **AI output.** Label it plainly as "Summary (auto)" with a small icon and an **Edit** link. Never use purple sparkles.

---

## 4. Mobile-first, one-handed patterns

### 4.1 Navigation

- **Below 1024px: a bottom tab bar with four destinations:** **Today, Leads, Calls, Settings.**
  - Tab bars are for navigation, with three to five destinations ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/tab-bars); [Material 3](https://m3.material.io/components/navigation-bar/guidelines)).
  - Hidden navigation hurts discoverability ([NN/g](https://www.nngroup.com/articles/hamburger-menus/)).
  - Vercel's 2026 dashboard uses a floating bottom bar on mobile, designed for one-handed use ([changelog](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)).
- **Tab details.**
  - Labels always visible; active icon filled.
  - The Leads tab carries an amber count badge for "needs reply".
  - Bar height 56px plus the bottom safe area.
- **Pushed screens such as lead detail** replace the tab bar with a sticky action bar.
- **At 1024px and up:** a collapsible shadcn sidebar (as in `sidebar-07`) with the same four items and a ⌘K search (`cmdk`). On mobile, search opens as a full-height sheet.

### 4.2 Thumb zones and touch targets

- **Placement** ([Hoober, UXmatters 2017](https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php)):
  - People look at and tap the centre most.
  - Centre targets can be about 7mm; corners need about 12mm.
  - About 75% of people tap with one thumb, but fewer than half hold the phone one-handed.
  - So: content in the centre, primary actions in full-width bottom bars, rare or destructive actions in a top-right overflow menu.
- **Sizes:**
  - **44×44px minimum** for every touch target ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/buttons); [WCAG 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)). Android asks for 48dp, about 9mm ([Google](https://support.google.com/accessibility/android/answer/7101858)). NN/g asks for about 1×1cm ([NN/g](https://www.nngroup.com/articles/touch-target-size/)). The legal floor is 24px ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
  - Every shadcn style ships `h-8` or `h-9` controls, so override them:
    - Default button and input height 44px (`h-11`), going back to `md:h-9` only on fine pointers.
    - Sticky primary CTA 48px (`h-12`), full width.
    - Icon buttons keep a 44px hit area around a 20–24px glyph.
  - Add `touch-action: manipulation`, and give buttons a visible `:active` state instead of the tap highlight ([Vercel guidelines](https://github.com/vercel-labs/web-interface-guidelines)).

### 4.3 Sheets instead of modals

- **Use sheets on mobile.** Create, edit, "Move to…", the message composer, filters and pickers all open as a bottom **Drawer**. On desktop, use a Responsive Dialog (Dice UI) or `Sheet`.
- **Use snap points** for the composer and filters, and `VirtualKeyboardProvider` for any sheet that has inputs ([Base UI Drawer](https://base-ui.com/react/components/drawer)).
- **Follow NN/g's rules** ([NN/g](https://www.nngroup.com/articles/bottom-sheet/)):
  - The Back gesture closes the sheet.
  - Always show a visible close button, not just a drag handle.
  - Never stack sheets.
  - Keep sheets short; long flows become pages.
- **Set `overscroll-behavior: contain`** inside sheets.

### 4.4 The Kanban on a phone

- **One column per screen.**
  - A horizontal scroller with `scroll-snap-type: x mandatory`.
  - Each column is `calc(100% - 24px)` wide so the next one peeks in.
  - A sticky row of stage chips with counts sits above it ("New 3", "Contacted 5", and so on). The chips sync through `IntersectionObserver` and persist as `?stage=` with nuqs.
  - Housecall Pro's mobile pipeline also swipes between columns ([help](https://help.housecallpro.com/en/articles/6185127-getting-started-with-pipeline)).
- **No drag on phones.** Every card has **Call** (primary), **Text** and **⋯**. The ⋯ opens a "Move to…" sheet that lists the stages and ticks the current one.
  - WCAG 2.2 requires a non-drag alternative for dragging and names Kanban boards explicitly ([2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html); [G219](https://www.w3.org/WAI/WCAG22/Techniques/general/G219)).
- **Stage changes ask for what they need** (a Housecall Pro pattern; cancelling returns the card to where it was):
  - Won asks for the job value, which feeds "recovered".
  - Lost asks for a reason (chips).
  - Scheduled asks for a time.
- **Drag from 768px up.** Use the Dice UI Kanban with a mouse sensor (5px distance), a touch sensor (250ms delay, 5px tolerance) and the keyboard sensor. The drag overlay lifts with a shadow and scales to 1.02. Moves are announced with `aria-live`.
- **No horizontal swipe actions on cards.** They fight column paging.
- **Ordering inside a column.** Longest-waiting first, then newest. No manual reordering.
- **Column headers** show the count and the total value in tabular figures.

### 4.5 Sticky primary actions and the keyboard

- **Lead detail** keeps a bottom bar with **Call**, **Text** and **Move**, inset by the safe area.
- **The request form** keeps its submit button sticky.
- **Never disable submit.** Validate on submit and show inline errors ([GOV.UK button](https://design-system.service.gov.uk/components/button/)).
- **Keyboard behaviour.** Set `interactiveWidget: "resizes-content"` so Chromium lifts fixed bars above the keyboard. iOS ignores this, so put form fields inside the Drawer's keyboard provider or use `VisualViewport` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)).

### 4.6 Freshness without pull-to-refresh

- **Don't rely on native pull-to-refresh.**
  - iOS home-screen web apps don't have it ([Discourse threads](https://meta.discourse.org/t/ios-pwa-app-pull-to-refresh/343262); [firt.dev notes](https://firt.dev/notes/pwa-ios/)).
  - Chrome Android does a full page reload.
- **Instead:**
  - TanStack Query refetches stale data on `visibilitychange`, which is exactly the "back between jobs" moment ([docs](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching)).
  - Poll the board every 30–60s while it is visible.
  - Send push notifications for new leads.
  - Show a small "Updated 2 min ago" with a refresh button on Today.
- **If you add a custom pull gesture**, limit it to the Leads and Calls lists. Have it invalidate queries rather than reload the page, and set `overscroll-behavior-y: contain` on those scrollers ([Chrome](https://developer.chrome.com/blog/overscroll-behavior)).

### 4.7 Installed-PWA checklist

```ts
// app/layout.tsx (static exports are fine with cacheComponents)
export const viewport: Viewport = {
  viewportFit: "cover",                      // supported in next@16.4.3's Viewport type
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#110f0d" },
  ],
  // Do NOT set maximumScale: 1 or userScalable: false (the Next docs example does). Never disable zoom.
};
export const metadata: Metadata = { appleWebApp: { capable: true, title: "LeadAnchor", statusBarStyle: "default" } };
```

- **Manifest.** Use `app/manifest.ts` with `display: "standalone"` and 192/512 icons. iOS push needs iOS 16.4 or later and an installed app ([Next PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)).
- **Install prompt.** Ask once, after the first recovered lead, using a sheet with iOS "Add to Home Screen" steps.
- **Safe areas.** Pad the tab bar and sticky bars with `max(env(safe-area-inset-bottom), 12px)`, and the header with `env(safe-area-inset-top)` ([MDN env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env)). Add Tailwind v4 utilities with `@utility pb-safe { … }` ([docs](https://tailwindcss.com/docs/adding-custom-styles#adding-custom-utilities)).
- **Chrome 135+ in a browser tab** draws edge-to-edge on Android. For fixed bottom bars, combine `env(safe-area-inset-bottom)` with `env(safe-area-max-inset-bottom, 36px)` as shown in [Chrome's guide](https://developer.chrome.com/docs/css-ui/edge-to-edge).
- **Viewport units.** Use `h-dvh` and `min-h-dvh`, never `h-screen` ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/length#dynamic_viewport_units)).
- **Status bar.** Only use `black-translucent` if the header is dark in both themes; its status-bar text is white.

### 4.8 The public request form (no login)

- **Fast and trusted.**
  - The page is server-rendered and loads fast over 4G.
  - The link token pre-fills the business and the customer's phone number, so never ask for them again.
  - The header shows the business name and logo, plus a line such as "Usually replies within 10 min".
- **One question per screen, three steps, with a "Step 2 of 3" indicator** ([GOV.UK](https://design-system.service.gov.uk/patterns/question-pages/); [one thing per page](https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/)):
  1. **Service.** Two-column tiles at least 64px tall.
  2. **The problem.**
     - Track A (trades): a textarea with example chips.
     - Track B (salons, groomers): preferred-time chips.
  3. **Photos.**
     - Two buttons: **Take photo** (`capture="environment"`, [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture)) and **Choose photos**.
     - Uploads start in the background as soon as photos are picked, each with its own progress bar (the ServiceTitan pattern; NN/g says progress bars for uploads).
     - Jobber accepts up to 4 photos on its request forms.
- **Consent.** End with a plain-language consent checkbox for texts, which feeds the consent ledger. The submit button is sticky.
- **Keep the draft.** Save it in `sessionStorage` so a reload, for example after the camera on a low-memory phone, doesn't lose anything.
- **Confirmation.** Say what happens next and give a tap-to-call button for the business.
- **No CAPTCHA puzzles.** Rate-limit by token on the server instead.

---

## 5. Inspiration products and the patterns to emulate

| Product | Pattern | Apply to LeadAnchor |
|---|---|---|
| **Linear** ([2024](https://linear.app/now/how-we-redesigned-the-linear-ui), [2026](https://linear.app/now/behind-the-latest-design-refresh), [workflows](https://linear.app/docs/configuring-workflows)) | Themes generated from three inputs; a dimmed sidebar; softened separators; warmer greys; fewer icons; status glyphs that fill as work progresses | OKLCH tokens, quiet navigation, and a small stage-progress glyph on cards |
| **Attio** ([records](https://attio.com/help/reference/managing-your-data/records/create-and-view-records), [mobile](https://attio.com/help/reference/tools-and-extensions/attio-on-mobile)) | Primary actions sit directly under the record name; Overview vs Activity tabs; the activity timeline can be filtered by event type; call recordings carry a transcript and summary; record tabs swipe on mobile | Lead header with Call/Text/Stage; an Activity / Messages segmented control; filter chips (All, Calls, Messages, Photos); the voicemail item shows a player, transcript and summary |
| **Folk** ([pipeline views](https://intercom.help/folk-app/en/articles/6044821-create-custom-pipeline-views)) | The pipeline is one status field; you pick which fields show on cards, such as phone | Cards show only name, the need, phone, waiting time and value |
| **Height** | Shut down on 24 Sep 2025 ([AlternativeTo](https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/)) | Don't use it as a reference. |
| **Jobber** ([requests](https://www.getjobber.com/features/quote-request-form/), [dashboard](https://help.getjobber.com/en/articles/dashboard/), [AI receptionist](https://www.getjobber.com/features/ai-receptionist/)) | The request → quote → job → invoice mental model; Home leads with recommended actions; request forms shared by link; photos on requests | A "Needs you now" list on Today, the photo step in the request form, and stage names in the owner's words. Its AI receptionist is a direct competitor: differentiate on the recovered-money story. |
| **Housecall Pro** ([pipeline](https://help.housecallpro.com/en/articles/6185127-getting-started-with-pipeline), Aug 2026) | Lead stages (New, First/Second/Third Contact, Won, Lost); press-and-hold drag that opens a details dialog, with cancel reverting; a status dropdown on every card; a quick view with call, chat and email; Quiet Hours for automated texts | The Move sheet, prompts on stage change, card quick actions, and a quiet-hours setting |
| **ServiceTitan Field Mobile** ([story](https://www.servicetitan.com/blog/success-story-goettl-field-mobile-app), Mar 2026) | "Fewer minutes inside the app" as the goal; batch photo capture with background upload; moving features breaks muscle memory | Design for 10-second sessions, upload in the background, and keep the tab layout stable from launch. |
| **Stripe Dashboard** ([basics](https://docs.stripe.com/dashboard/basics), [charts](https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights)) | Home surfaces things that need action; charts are labelled as estimates; a comparison-period picker | "Recovered this month (est.)" with a "How we count this" sheet, and deltas against a named period |
| **Vercel Dashboard** ([2026 nav](https://vercel.com/changelog/dashboard-navigation-redesign-rollout), [Geist](https://vercel.com/geist/introduction)) | A resizable, hideable desktop sidebar; a floating one-handed bottom bar on mobile; a published interface checklist | The navigation split in §4.1 and the QA checklist |

**Component specs**

```text
LEAD CARD (mobile column)                                    all targets >= 44px
+----------------------------------------------------+
| [!] Waiting 12 min                      $350 est.  |  amber chip: icon + words | tabular value
| Maria Lopez                                        |  Atkinson 600, 17px
| Water heater leaking in garage                     |  15px, one line, truncated
| (512) 555-0142        [photo icon] 3 photos        |  15px muted, phone in tabular figures
| [   Call   ]  [   Text   ]                [ ... ] |  Call = primary green; ... = Move / Won / Lost
+----------------------------------------------------+

LEAD DETAIL (mobile)
< Maria Lopez                         [ Quoted  v ]     stage control opens the Move sheet
  Summary (auto)                                        info-subtle card, no sparkles
  50-gal gas water heater leaking at the base; wants a quote today; prefers texts.
  From voicemail and request form                [Edit]
  [ Activity | Messages ]
  [All] [Calls] [Messages] [Photos]
  Today
  o 2:14 PM  Missed call                 amber icon
  |          Auto-reply sent             Delivered
  o 2:15 PM  Voicemail  0:42            [play]  transcript: 3 lines, "Show all"
  o 2:20 PM  Request form submitted      [img][img][img]  tags: water heater, corrosion (auto)
  o 2:21 PM  Agreed to texts (form)      shield icon, neutral; a STOP reply shows in destructive-subtle
+----------------------------------------------------+
| [    Call    ]  [    Text    ]  [  Move  ]         |  sticky, safe-area padded
+----------------------------------------------------+

KPI TILE (Today; exactly one hero per view)
Recovered this month (est.)          label: sentence case, muted
$4,820                               Archivo 600, 112.5%, 48px, foreground ink
[up arrow] +$1,140 vs September      green only because up is good; sign + arrow + named period
[12-week sparkline]                  past weeks: light green step; this week: Anchor green
How we count this                    text button that opens a sheet
Below it: two plain tiles ("Missed calls caught 18", "Median reply 4 min"), then the "Needs you now" list.
```

---

## 6. Do / don't

1. **Do** keep one accent with reserved signals: green for action, money and won; amber only when someone is waiting; red only for failures and STOP. **Don't** use indigo or violet, gradients, glass, or emoji.
2. **Do** make every touch target at least 44px and put primary actions in sticky bottom bars. **Don't** require dragging: every card gets a "Move to…" sheet, and drag is a ≥768px bonus.
3. **Do** use bottom sheets (Base UI Drawer) for create, edit, move and compose on mobile, with Back closing them. **Don't** use centred modals or stacked sheets.
4. **Do** use Archivo for headings and money and Atkinson Hyperlegible Next for UI, with `tabular-nums` wherever numbers align or update. **Don't** use Inter or Geist, ALL-CAPS eyebrows, or monospace data labels.
5. **Don't** ship shadcn defaults: no four identical gradient KPI cards, no shadows at rest, no `h-9` touch controls, no raw Tailwind palette classes. **Do** show one honest hero number per screen and animate only in response to the user (≤250ms, reduced motion respected).

## 7. Open questions for the client

- **Tap to call.** A `tel:` link is instant, but the customer sees the owner's cell number and the call isn't logged. A Telnyx bridge (call the owner, then connect) shows the business number and logs the call. The UI differs only in a "Calling you now, answer to connect" sheet.
- **"Money recovered".** Is it the job values entered on Won, or invoiced and paid amounts? Either way, the tile says "est." until it is paid.
- **Brand hue.** Check Anchor green against the competitors the owners already use (Jobber, Housecall Pro). The petrol fallback is in §3.4.
- **Technicians.** Should the `technician` role get the same four tabs, or Today and Leads only?

## 8. Sources

**Libraries and platform**

- [shadcn changelog](https://ui.shadcn.com/docs/changelog): [Base UI as the default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default), [`npx shadcn create`](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)
- [shadcn source](https://github.com/shadcn-ui/ui)
- [Base UI](https://base-ui.com/react/components/drawer) and its [releases](https://github.com/mui/base-ui/releases)
- [Vaul](https://github.com/emilkowalski/vaul), [Sonner](https://github.com/emilkowalski/sonner), [cmdk](https://github.com/dip/cmdk)
- [dnd-kit](https://dndkit.com) and its [sensors guide](https://dndkit.com/react/guides/sensors), [Pragmatic DnD](https://github.com/atlassian/pragmatic-drag-and-drop)
- [Dice UI Kanban](https://diceui.com/docs/components/kanban), [ReUI](https://github.com/keenthemes/reui), [Kibo UI](https://github.com/shadcnblocks/kibo)
- [coss ui](https://github.com/cosscom/ui) and its [licensing](https://github.com/cosscom/ui/blob/main/LICENSING.md)
- [Tremor](https://github.com/tremorlabs/tremor), [Recharts](https://github.com/recharts/recharts), [Motion](https://motion.dev/docs/react-accessibility), [NumberFlow](https://number-flow.barvian.me)
- [Tabler Icons](https://github.com/tabler/tabler-icons), [Lucide](https://github.com/lucide-icons/lucide)
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching), [nuqs](https://github.com/47ng/nuqs), [date-fns](https://github.com/date-fns/date-fns), [libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js)
- [Serwist](https://github.com/serwist/serwist)
- [Next.js 16](https://nextjs.org/blog/next-16), [the Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [`generateViewport`](https://nextjs.org/docs/app/api-reference/functions/generate-viewport)
- Tailwind [theme](https://tailwindcss.com/docs/theme) and [font-stretch](https://tailwindcss.com/docs/font-stretch)
- [Temporal browser support](https://caniuse.com/temporal): not in Safari as of mid-2026, so stay on date-fns.

**Fonts and colour**

- [Archivo](https://github.com/Omnibus-Type/Archivo) and its [Google Fonts description](https://github.com/google/fonts/tree/main/ofl/archivo)
- [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/) and its [repo](https://github.com/googlefonts/atkinson-hyperlegible-next)
- [OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl), [Harmonizer](https://evilmartians.com/opensource/harmonizer)
- [Stripe: accessible colour systems](https://stripe.com/blog/accessible-color-systems)
- Linear's [2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) and [2026 refresh](https://linear.app/now/behind-the-latest-design-refresh)

**"AI slop" patterns**

- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- [Claude blog, Nov 2025](https://claude.com/blog/improving-frontend-design-through-skills)
- [Adam Wathan](https://x.com/adamwathan/status/1953510802159219096)
- [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
- [SCALR](https://scalr.sg/blog/20-signs-a-website-was-made-by-ai/)
- [Sailop](https://sailop.com/blog/detect-ai-generated-site-30-seconds-21-signs-2026)
- [925studios](https://www.925studios.co/blog/ai-slop-web-design-guide)
- [Gabriel Hidalgo](https://www.gabrielhidalgo.design/blog/make-website-look-less-ai-generated)
- [smoothui](https://smoothui.dev/blog/ai-design-slop)

**Mobile, accessibility and UX research**

- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines)
- [Hoober 2017](https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php), [Hoober 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)
- NN/g on [touch targets](https://www.nngroup.com/articles/touch-target-size/), [bottom sheets](https://www.nngroup.com/articles/bottom-sheet/), [skeletons](https://www.nngroup.com/articles/skeleton-screens/), [empty states](https://www.nngroup.com/articles/empty-state-interface-design/), [animation duration](https://www.nngroup.com/articles/animation-duration/) and [hamburger menus](https://www.nngroup.com/articles/hamburger-menus/)
- WCAG 2.2 [2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [G219](https://www.w3.org/WAI/WCAG22/Techniques/general/G219), [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) and [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- Apple HIG [tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) and [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- Material 3 [navigation bar](https://m3.material.io/components/navigation-bar/guidelines) and [bottom sheets](https://m3.material.io/components/bottom-sheets/guidelines)
- [Android touch targets](https://support.google.com/accessibility/android/answer/7101858)
- [Chrome edge-to-edge](https://developer.chrome.com/docs/css-ui/edge-to-edge), [Chrome overscroll-behavior](https://developer.chrome.com/blog/overscroll-behavior), [MDN env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env)
- [firt.dev iOS PWA notes](https://firt.dev/notes/pwa-ios/), [Discourse iOS pull-to-refresh](https://meta.discourse.org/t/pull-to-refresh-for-ios-app/343667)
- GOV.UK [question pages](https://design-system.service.gov.uk/patterns/question-pages/) and [button](https://design-system.service.gov.uk/components/button/)

**Products:** see the links in the §5 table.

---
name: Cinematic Afro-Modern Stream
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393e'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#1a1c20'
  surface-container: '#1e2024'
  surface-container-high: '#282a2e'
  surface-container-highest: '#333539'
  on-surface: '#e2e2e8'
  on-surface-variant: '#bdcbb6'
  inverse-surface: '#e2e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#879582'
  outline-variant: '#3e4a3a'
  surface-tint: '#62e05c'
  primary: '#cfffc3'
  on-primary: '#003a05'
  primary-container: '#72f06a'
  on-primary-container: '#006c11'
  inverse-primary: '#006e11'
  secondary: '#e9c349'
  on-secondary: '#3c2f00'
  secondary-container: '#af8d11'
  on-secondary-container: '#342800'
  tertiary: '#ffefe8'
  on-tertiary: '#482916'
  tertiary-container: '#ffcbaf'
  on-tertiary-container: '#7a543e'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7ffd75'
  primary-fixed-dim: '#62e05c'
  on-primary-fixed: '#002202'
  on-primary-fixed-variant: '#00530a'
  secondary-fixed: '#ffe088'
  secondary-fixed-dim: '#e9c349'
  on-secondary-fixed: '#241a00'
  on-secondary-fixed-variant: '#574500'
  tertiary-fixed: '#ffdbc9'
  tertiary-fixed-dim: '#eebca0'
  on-tertiary-fixed: '#2f1404'
  on-tertiary-fixed-variant: '#623e2a'
  background: '#111317'
  on-background: '#e2e2e8'
  surface-variant: '#333539'
typography:
  display-hero:
    fontFamily: Sora
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 46px
  display-hero-mobile:
    fontFamily: Sora
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 34px
  headline-lg:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 38px
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-md:
    fontFamily: Sora
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  headline-sm:
    fontFamily: Sora
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 18px
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style
This design system sets a cinematic, high-energy tone anchored in contemporary African digital expression and sleek premium entertainment. The interface balances high-impact visual drama with effortless utility. Designed mobile-first for media immersion, it pairs deep black canvases with an electric luminescent green accent that evokes vitality, pulse, and forward-looking digital culture.

The design movement mixes **Dark-Mode Cinematic Minimalism** with subtle **Tactile Glass & Glow Elements**. Large-format film artwork, high-contrast typography, and glowing electric accents direct immediate focus to stories, performances, and curated playlists. VIP and premium membership states are set apart with a warm, metallic gold gradient, providing an exclusive distinction within the platform's signature green ecosystem.

## Colors
The palette is built strictly for dark-ambient viewing, maximizing display contrast while eliminating eye strain during prolonged screen sessions:

- **Base Canvas (`#0E1014`)**: A deep, neutral obsidian that recedes behind content, letting cinematic key-art pop forward.
- **Card Surface (`#1A1D23`)**: Primary container surface for media tiles, modular drawers, and floating trays.
- **Secondary Surface (`#22262D`)**: Interactive items, pills, unselected states, bottom sheets, and elevated overlays.
- **Structural Border (`#2A2E36`)**: Subtle, low-contrast boundary lines to define edges without visual noise.
- **Electric Green (`#72F06A`)**: Primary brand signature. Used exclusively for CTAs, playback progression, active navigation items, badges, and offline downloads.
- **VIP Gold Gradient (`#E5C365` to `#A87922`, centered at `#D4AF37`)**: Reserved strictly for VIP tiers, original premieres, and elite subscriber banners.
- **Primary Text (`#FFFFFF`)**: Pure high-contrast white for bold headlines, titles, and active inputs.
- **Secondary Text (`#9299A5`)**: Cool gray for episodic metadata, runtimes, genre tags, and system labels.

## Typography
Typographic scale balances geometric modernism with high-density mobile legibility:

- **Headline Family (Sora)**: Provides punchy, futuristic geometric presence for titles, series names, and hero billboards. The tight kerning and wide apexes bring a confident Afro-futuristic posture.
- **Body & Interface Family (Hanken Grotesk)**: Selected for its crisp vertical proportions, open apertures, and clarity in small-screen video descriptions, duration labels, and episode lists.
- **Editorial Constraints**: Hero billboard titles (`display-hero-mobile`) are restricted to a maximum of 3 lines on mobile viewports. Runtimes, genre markers, and age ratings utilize uppercase `label-sm` with +0.5px tracking.

## Layout & Spacing
Designed explicitly for modern hand-held viewports (360px–412px target base) using a fluid column structure:

- **Grid Model**: 4-column fluid mobile grid with `16px` (`1rem`) outer screen margins and `12px` (`0.75rem`) inter-card gutters. Horizontal scrolling carousels break outside the layout margins to bleed edge-to-edge, snapping smoothly with `16px` lead-in padding.
- **Vertical Rhythm**: Content blocks and category rows are spaced using `space-lg` (`24px`). Major category shifts (e.g., Live Channels to Original Series) scale up to `space-xl` (`36px`).
- **Thumb-Zone Architecture**: Primary playback, profile toggles, and search trays anchor inside a persistent floating glass bottom navigation bar set within safe-area boundaries (`env(safe-area-inset-bottom)`).

## Elevation & Depth
Depth relies on deliberate tonal layering, soft perimeter strokes, and colored backlights rather than heavy drop shadows:

- **Level 0 (Canvas)**: Background (`#0E1014`) holding full-bleed backdrop art and scrolling rails.
- **Level 1 (Card Baseline)**: `#1A1D23` surfaces defined by a 1px border of `#2A2E36`. Zero drop shadow.
- **Level 2 (Floating Controls & Trays)**: `#22262D` surfaces with a 1px hairline stroke (`rgba(255, 255, 255, 0.08)`) and a subtle ambient occlusion shadow (`0 8px 24px rgba(0, 0, 0, 0.5)`).
- **Level 3 (Modal Bottom Sheets)**: Frosted glass `#1A1D23` at 85% opacity with `backdrop-filter: blur(20px)` and an upper edge highlight of `rgba(255, 255, 255, 0.12)`.
- **Luminescent Accent Aura**: Interactive active states and hero primary CTAs leverage a focused neon drop shadow: `0 4px 16px rgba(114, 240, 106, 0.28)`. VIP elements swap this glow to a warm gold aura: `0 4px 16px rgba(212, 175, 55, 0.24)`.

## Shapes
The visual identity embraces a unified soft-geometric philosophy that pairs structural card corners with fluid pill-shaped controls:

- **Media Cards & Carousels**: 12px to 16px corner radii. Vertical posters (2:3) use 12px; landscape episode tiles (16:9) and billboard banners use 16px.
- **Interactive Controls (Pills)**: Buttons, active genre filters, search capsules, and download triggers strictly use full pill geometry (`border-radius: 9999px`).
- **Badges & Overlays**: Floating timecode markers, audio quality tags (e.g., 4K HDR, Dolby Atmos), and age ratings use 6px soft radii for compact density.

## Components

### Buttons
- **Primary Action (Watch Now / Play)**: Full pill shape, solid `#72F06A` fill, `#0E1014` text set in `label-lg`, with subtle `rgba(114, 240, 106, 0.3)` glow.
- **Secondary Action (Add to List / Trailer)**: Full pill shape, semi-transparent `#22262D` background, `#FFFFFF` text, and a crisp `#2A2E36` 1px border.
- **VIP Upgrade CTA**: Full pill with an angled metallic gold gradient (`linear-gradient(135deg, #F3D98A 0%, #D4AF37 50%, #916615 100%)`), dark umber text (`#1C1300`), and a directional sheen.

### Chips & Filter Pills
- **Unselected**: Solid `#22262D` background, `#9299A5` text, pill radius, `8px 14px` padding.
- **Selected / Active**: Solid `#72F06A` background with `#0E1014` bold text, or `#1A1D23` background with a bright `#72F06A` border stroke and matching text color.

### Content Cards
- **Poster Cards (Portrait 2:3)**: `#1A1D23` background, 12px border radius, 1px `#2A2E36` border. Poster image fills the card with top-right download or bookmark indicators.
- **Landscape Episode Cards (16:9)**: Upper half contains thumbnail with a centered translucent play icon; lower half holds episode title in `#FFFFFF`, runtime in `#9299A5`, and an electric green progress bar along the bottom edge.

### Lists & Episode Rows
- Clean modular horizontal strips on `#1A1D23`. Left: 16:9 thumbnail preview. Right: Episode index number, title, concise description, and quick download action button. Separated by hairline dividers (`#2A2E36`).

### Input Fields
- Enclosed capsules (`border-radius: 9999px`) or soft rectangles (`12px`). Background: `#1A1D23`. Border: 1px solid `#2A2E36`. Active state shifts the border to `#72F06A` with an ambient glow. Placeholder text in `#9299A5`.

### VIP Membership Banner
- Dedicated showcase card using a 16px radius with an inner border of `rgba(212, 175, 55, 0.35)` and a rich background blend of `#1A1D23` bleeding into deep bronze. Features the signature gold gradient badge and typography.

### Progress & Live Indicators
- **Media Playback Scrubbers**: Background track `#22262D`, filled state `#72F06A`, scrubber thumb with electric green glow.
- **Live Tag**: Pill badge with solid red accent (`#FF3B30`) or green radar pulse dot for real-time broadcasts.
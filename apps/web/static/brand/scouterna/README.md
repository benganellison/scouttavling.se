# Scouterna logo files

Official logo files from Scouterna's graphic profile (Oct 2023), copied **unchanged**:

- Source: https://www.scouterna.se/scout-ledare-kar/kommunicera/grafisk-profil/
- `scouterna_blue_RGB.svg`: blue logo, for white and light backgrounds (and light, calm images).
- `scouterna_white_RGB.svg`: white logo, for Scoutblå and dark backgrounds/images.
- `scouterna_tagline_blue_RGB.svg` / `scouterna_tagline_white_RGB.svg`: with "Raised by Adventure".

Do not edit these files. Render them with `#lib/ui/brand/ScouternaLogo.svelte`, which applies the rules below.

## Usage rules (from the brand manual)

- **Blue on white/light, white on Scoutblå/dark.** Black only when colour is impossible (e.g. black-and-white print).
- **Never** recolour, distort, rotate, add effects (shadows, outlines), separate the symbol from the wordmark, or retype the tagline.
- **Clear space:** at least 1× the x-height of the lowercase letters in "Scouterna" on every side. No text or graphics inside it.
- **Minimum size:** 250 px wide on screen, 35 mm in print.
- **Tagline variants** ("Raised by Adventure") are preferred in external communication, but must **not** be used when the tagline also appears as a heading on the same page.
- **Senders:** kårer and events must always show Scouterna as a clear sender, combined with their own logo.

## Colours

- **Scoutblå** `#003660` is the main colour and must dominate. Never tinted or made transparent.
- Complementary colours (never dominant, never tinted, never transparent): Spårargrön `#41a62a`, Upptäckarblå `#00a8e1`, Äventyrarorange `#e95f13`, Utmanarrosa `#da005e`, Rovergul `#e2e000`; `#837a02` only on Rovergul.
- Age groups: Spårare green, Upptäckare blue, Äventyrare orange, Utmanare pink, Rover yellow.
- Text is primarily black, Scoutblå or white. Compute real WCAG contrast (`#lib/brand/colors.ts`).

## Typefaces

TeeFranklin + Adobe Garamond Pro (licensed). On the web we self-host free equivalents via fontsource:
Libre Franklin (headings, UI) and EB Garamond (longer public body text only).

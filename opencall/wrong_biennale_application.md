# The Wrong Eclipse — Application Strategy & Landing-Page Critique

> Consolidated thinking for submitting **"Earth is the Oldest Stereoscope"** to **The Wrong Eclipse** (The Wrong Biennale, 2026).
> Companion to [`wrong_biennale.md`](./wrong_biennale.md). Written June 13, 2026.

---

## 0. TL;DR

- **You have time.** The deadline is **June 26, 2026** — *not* June 12. The companion pack (`wrong_biennale.md`) is stale; the live thewrong.org/Eclipse page lists the deadline as June 26, with a selection window of **June 12 – July 12**. You have ~13 days. **Submit early** (selection is already underway).
- **You should submit. It's a strong fit.** The concept is already Wrong-native: two horizon-tracking telescopes conscripted into a stereo pair is a literal *misreading of an astronomical system* — which is verbatim what the call asks for.
- **Your instinct about the landing is correct,** but the fix is the opposite of what you might fear. The piece is *not* "too polished to belong" — polish is welcomed here. It currently reads as a **tech demo that explains before it seduces.** The fix is **conceptual reframing, not roughing it up.**
- **The single highest-leverage change:** put the *actual Moon footage* — wiggling in eclipse light, clouds drifting through, the image fighting to resolve — on the landing itself, instead of hiding it behind an abstract diagram and a two-page onboarding wizard. Lead with the poetry; let the wrongness you already have (jitter, clouds, the Moon lost at the edges) *be the work.*

---

## 1. Should you submit? Yes.

Four reasons it fits The Wrong Eclipse cleanly:

1. **It's a literal "misinterpretation of an astronomical system."** The call asks for work that *"misinterpret[s] systems (astronomical or otherwise)."* Two telescopes built to *track* the Moon are instead conscripted into *seeing depth* — a use the cosmos never offered. That's the strongest single fit point, and it's currently underplayed.
2. **Stereoscopy is obsolete vision = built-in ephemerality.** A 19th-century, near-dead way of seeing maps directly onto the show's love of *"time-based, unstable, or disappearing formats."*
3. **It's genuinely web-*for*-the-web.** WebGL experienced in a browser tab, self-hosted, free, links out. Meets every mechanical requirement, and immersive WebGL/3D is an established, *praised* strand at The Wrong (not an outlier — see §5).
4. **It hits the "wonder / shine bright" half of the brief already.** A luminous Moon over a dark field is exactly *"highlight wonder… let's make screens shine bright."* What's missing is the *other* half — error, shadow, disappearance — which your footage already contains but the site currently hides.

**One caveat to internalize:** The Wrong is radically inclusive ("Instant Radical Inclusion" / *"Why choose if you have room for everyone?"*), so this is not a competitive juried gauntlet. But The Wrong Eclipse specifically is a **curated 24h showcase by David Quiles Guilló** ("for showcase if selected"), so theme fit and *reading as art-of-the-internet rather than a product demo* do matter.

---

## 2. What The Wrong actually is, and what it rewards

The Wrong is a decentralized "New Digital Art Biennale" founded by **David Quiles Guilló in 2013** — *"a website of websites," "an exhibition of exhibitions."* Seven editions, 10,000+ artists, hundreds of self-hosted **pavilions** (online) and physical **embassies**. It exists to circumvent *"the elitist infrastructure of established art fairs."* Rhizome famously called it *"a biennial in 22 tabs."*

**What it rewards** (from founder interviews + Rhizome / Hyperallergic / HEAD Foundation):

- **Concept native to the internet over craft as an end.** Guilló: it gathers *"art made for internet, with internet,"* not *"conventional art via internet."* The differentiator is whether polish serves an *idea* — not whether it signals competence.
- **Error, glitch, "wrongness" as authenticity.** The genre's thesis is JODI's *"Something Wrong is Nothing Wrong"* — the malfunction *is* the work. The Wrong *"welcomes technical failure"* as a feature.
- **Ephemerality, instability, link-rot embraced.** *"Open, unstable, and unfinished"* (HEAD/Stella Lai). The pavilion *"Not Found, A Broken Net Art Exhibition"* makes decay itself the content.
- **The web's messy structure as form.** *"Decentralised, fragmented, and full of accidental discoveries."* Discovery/wandering over a conversion funnel.
- **Anti-corporate-polish, anti-funnel.** The tell of *not* belonging: a site that *"uses polish as a competence signal and routes you toward one goal."*
- **Humor, irreverence, vernacular surfaces.** Comic Sans pavilions, "fried memes." The Eclipse host frame itself is plain white, Times New Roman, one static eclipse PNG on cargo.site — **deliberately lo-fi.**

### The Eclipse theme — a dual mandate held in tension (verbatim from the live page)

> *"Let's make screens shine bright."* · *"Highlight wonder."*

…sitting right beside…

> *"obscure certainty (glitches, shadows, and shared imaginaries)… embrace error and interruption, misinterpret systems (astronomical or otherwise), exist temporarily, conditionally, incorrectly… imagining new collective futures beyond visibility."*

> Tagline: **"Let the light go. Make something else appear."**

**The fit verdict:** clean/legible is *not* disqualifying — "shine bright" and "wonder" are literally requested. But a purely polished, *correct*, frictionless stereo-Moon simulator hits only that half and misses the load-bearing half: **error, disappearance, the incorrect, the temporary.** Your piece is well-positioned to hit both — the wrongness is already in the material.

### A note on competitive context

Polish is welcomed, not penalized. The research found **no** criticism that Wrong works are "too slick"; the only recurring critique (Rhizome) is that quality is too *uneven/low*. Clean immersive WebGL pavilions like *Desktop Studies* (2023, newart.city) were praised for *"coherence."* **So your craft is an asset.** Sitting inside a deliberately plain host frame, a polished piece *stands out without clashing.*

---

## 3. Honest critique of the current landing page

(Based on the working-tree `fix-intro` version — the 2-page intro you're mid-rework on — not the stale 4-page deploy.)

### Keep these — they're genuinely good

- **The title and the lineage.** *"Earth is the Oldest Stereoscope"* is the whole pitch in five words, and the Nam June Paik echo (*Moon is the Oldest TV*, 1965) is a gift. Lead with it harder.
- **The typographic craft.** Redaction 35 + monospace + warm-grey-on-black is sophisticated and *on-theme* — Redaction is literally a typeface built on redaction/obscured text, quietly carrying *"obscure certainty."* **Do not change the type or palette.**
- **Glasses-free wiggle as the default** — smart, low-friction, no hardware gate.
- **Mobile** is already handled well (single-column, abbreviated labels).

### The four problems behind "tech demo / explains before it seduces"

1. **The art is hidden behind ENTER.** The landing background is the *abstract mono orbital diagram* plus a text card. The actually-arresting thing — the real Moon footage wiggling in eerie eclipse light, with clouds drifting through it — only appears *after* you click into the stereo view. **The hook is buried.** For a show navigated as 22 tabs, where people surf dozens of works, the first 2 seconds have to seduce, not orient.
2. **It's an onboarding wizard, not an artwork.** "Page 0 → NEXT → *How to See It* → keyboard shortcuts → ENTER" is a product funnel routing you to one goal — exactly the corporate tell ("optimize a single funnel") versus the Wrong's "discovery mode / spot the art." It reads as UX, not as a piece.
3. **It leads with mechanism, not meaning.** A live baseline-km / parallax-angle stats dashboard is a *correctness/precision flex* — competence signaling. The poetry (two strangers half a planet apart becoming one pair of eyes; *a Moon no single observer can see*) is demoted to a single sentence.
4. **It suppresses its own best material.** The jitter, the clouds rolling in, the Moon sliding out of frame at the start and end — the genuinely *wrong*, eclipse-native, emotionally resonant parts — are trimmed/hidden in favor of a clean loop. **That's throwing away the exact thing this show is asking for.** Your footage's imperfections aren't bugs to hide; they're "embrace error and interruption / let the light go" made literal — and they're *earned* (real atmosphere, real weather over two cities, the real limits of two amateur rooftops), not a filter.

**Bottom line:** Don't make it uglier to belong. Make the *concept* legible as a productive misreading, put the Moon first, name the wrongness, and let the image break or go dark at least once. **Reframe, don't rebuild.**

---

## 4. The reframe — from "precision" to "productive misreading"

The whole pipeline strives for *correctness* (sub-degree alignment, rigorous astronomy). The Wrong celebrates *wrongness*. That looks like a contradiction; it's actually the piece's best story:

> **The algorithm fights to be exact. The world refuses.** Clouds roll through. The Moon jitters and drifts out of frame. Two rooftops, half a planet apart, can only agree on where the Moon is for a few minutes during an eclipse. The precision is the *aspiration*; the interference is the *truth*. The work is what survives the gap between them — a Moon no one on Earth can see alone, assembled in the dark, briefly, before the light comes back.

That single framing converts a "tech demo" into a Wrong-native artwork — and it requires almost no new code, just foregrounding what you already have and rewriting the copy.

---

## 5. What past Wrong submissions look like (touchstones to borrow from)

- **JODI — `wwwwwwwww.jodi.org` / "Something Wrong is Nothing Wrong."** Controlled malfunction *is* the work. **Borrow:** let the stereo fusion refuse to resolve, or the Moon dissolve to black, at least once.
- **"Not Found, A Broken Net Art Exhibition"** (Cesar Escudero Andaluz & Mario Santamaría). A collection of dead/broken net.art — decay and disappearance as content. **Borrow:** name the piece's own conditional, fleeting existence (online only Aug 1–31; the alignment lasted minutes).
- **The Chambers Pavilion** (Sara Ludy, 2013) — an austere blueprint floorplan you click *into*; the entry screen *is* the artwork, not an onboarding wizard. **Borrow:** a single-gesture entry you enter, not instructions you read.
- **Olia Lialina — "A Vernacular Web" / "My Boyfriend Came Back From the War"** — uses load/delay/slowness as expressive material. **Borrow:** directly resonant with *"light will hesitate"* — let hesitation/slowness be felt, not engineered away.
- **Desktop Studies (2023, newart.city) + Spatial.io `@biennaleio`** — clean immersive WebGL/3D, praised for coherence. **Borrow:** proof you can keep your production quality. You have license to stay polished.
- **Sucuk und Bratwurst — minimal video loops ("minimal-digi-zen").** Quiet, restrained, looping minimalism is fully Wrong-native. **Borrow:** your dark/minimal register is on-brand, not off.
- **The Eclipse host frame itself** (white bg, Times New Roman, one static eclipse PNG on Cargo). **Context:** your piece sits inside a deliberately lo-fi wrapper, so it pops without needing to be "roughed up."

---

## 6. Recommended landing redesign (the plan)

Keep the typography, palette, and wiggle default. Five moves, in priority order. *(This is the redesign plan; implementation is a separate, approved follow-up.)*

1. **The Moon seduces first.** Make the landing background the *actual stereo footage* (wiggle), not the abstract diagram. The orbital diagram demotes to the existing **Simulation** tab / a secondary "how it works" reveal.
   - Files: `frontend/src/App.tsx` (today the stereo canvas is `display:none` during `view==='introduction'` — stop hiding it), `frontend/src/main.tsx` (drive the stereo renderer + autoplay/loop in wiggle during the intro; the card overlays it), `frontend/src/state.ts` (entry flow).
2. **Lead with poetry, not mechanism.** Rewrite `page0Content()` in `frontend/src/components/IntroductionView.tsx` — open on the Paik lineage and the productive misreading (two strangers, one Moon, ~7,800 km apart becoming a single pair of eyes; *a Moon no one on Earth can see alone*). Demote the baseline/parallax stats to an ambient/secondary spot (or into the diagram view), not the hero.
3. **Show the wrongness; don't hide it.** Stop trimming the imperfect segments. Let the clouds, jitter, and Moon-loss be visible and *named* in the copy — e.g. *"Clouds roll through. The Moon drifts out of frame. The alignment is never perfect — two rooftops, one eclipse, a few minutes of agreement."* Consider seeking the intro playhead to a cloud/drift moment so the first thing you see is the image *resisting* resolution, then fusing — *"let the light go, make something else appear."*
4. **Kill the wizard.** Collapse the 2-page NEXT/ENTER card into a single, quiet, *dismissible* title+concept overlay. Move *"How to See It"* / keyboard shortcuts into `ControlPanel.tsx` or a discoverable "?" affordance — discovery, not a mandatory funnel. Entry into the work is immediate.
5. **Name the ephemerality.** One line acknowledging it lives online only Aug 1–31 and is shown during the 24h eclipse — hits *"exist temporarily, conditionally."*

**Optional stretch:** a deliberate "fusion-break" / dissolve-to-dark beat at the loop boundary as an explicit eclipse/error gesture (`frontend/src/stereo.ts` / `frontend/src/sync.ts`).

---

## 7. The submission itself

### Corrected logistics (verify on thewrong.org before sending)

| Item | Detail |
| --- | --- |
| **Deadline** | **June 26, 2026** (selection June 12 – July 12) |
| **Online window** | Work must be live **Aug 1–31, 2026** |
| **Public showcase** | **Aug 12, 2026**, during the 24h eclipse |
| **How to submit** | Email a link to your proposal to **thewrongbiennale@gmail.com**, subject **"The Wrong Eclipse"** |
| **Cost** | Free. No fees. Self-hosted. |
| **Avoid** | News/conflict/hate/violence themes; crypto/commercial vehicles. Tone is wonder + celebration. |

### Refined pitch angles (foreground the *misreading*, not the engineering)

- **Eclipse-native, twice over.** Made *during* the March 2026 lunar eclipse; submitted *to* an eclipse-timed show. Two hemispheres briefly agreeing the Moon is there.
- **A productive misreading of an astronomical system.** Telescopes that should track the Moon are conscripted into seeing depth — exactly *"misinterpret systems (astronomical or otherwise)."*
- **Obscured certainty / shadows.** Built on eclipse shadow, on a parallax (~1.18°) at the edge of perception, on clouds and jitter and a Moon that keeps slipping out of frame — *"obscure certainty… let the light go."*
- **Shared imaginaries / collective futures beyond visibility.** Two strangers on two rooftops, half a planet apart, forming one gaze — a hopeful image assembled in the dark.
- **Web-for-the-web, ephemeral by nature.** Stereoscopy as obsolete vision; the alignment lasted minutes; the work exists online only for August.

### Ready-to-send email draft

```
To: thewrongbiennale@gmail.com
Subject: The Wrong Eclipse

Hi David and The Wrong team,

I'd like to submit the following web-based work to The Wrong Eclipse:

Title: Earth is the Oldest Stereoscope (2026)
Artist: Yufeng Zhao
Live link: https://stereoscope.yufeng.place
Code: https://github.com/yz3440/earth-is-the-oldeest-stereoscope
One line: A stereo pair of the Moon, recorded at the same instant from
Boston and Santiago during the March 2026 eclipse. Two rooftops about
7,800 km apart become a single pair of eyes, and you see a Moon no one on
Earth can see alone.

The piece misreads an astronomical system. Two telescopes built to track
the Moon are used instead to see depth. The image never fully resolves:
clouds roll through, it jitters, the Moon drifts out of frame, and the two
cities only agree on it for a few minutes. The work is web-based,
self-hosted, and stays online August 1 to 31, 2026.

Best,
Yufeng Zhao
yufengzhao.com
```

### Pre-send checklist

- [ ] **Land the redesign first** (or at least moves #1–#3) so the live link leads with the Moon and the wrongness, not the wizard.
- [ ] Confirm `https://stereoscope.yufeng.place` loads in a **fresh browser** and **on mobile**, and stays up through Aug 31 (mind the blob-preload hosting quirk).
- [ ] Fix the repo-name typo if you re-host (`oldeest` → `oldest`), or just keep the link consistent in the email.
- [ ] Verify the deadline/cutoff time directly on thewrong.org before sending; submit early in the June 12–July 12 window.
- [ ] Keep the email plain text, warm, and human — they explicitly ask for that tone.

---

## 8. Sources

**The Wrong Eclipse / open call (verbatim theme + logistics):**
- https://thewrong.org/ and https://thewrong.org/Eclipse (live page; deadline June 26, the dual mandate, "Let the light go")

**The Wrong — overview, ethos, curator:**
- https://hyperallergic.com/the-wrong-biennale-seeks-to-create-the-right-conditions-for-digital-art/ ("instant radical inclusion")
- https://digest.headfoundation.org/2025/09/21/the-wrong-way-to-look-at-art-and-why-it-might-be-right/ ("open, unstable, and unfinished")
- https://rhizome.org/editorial/2016/jan/07/review-the-wrong-a-biennial-in-22-tabs/ ("a biennial in 22 tabs")
- https://rhizome.org/editorial/2015/dec/01/the-wrong-biennale-review/ ("wild variations in quality")
- https://log.fakewhale.xyz/the-wrong-biennale-is-reshaping-the-experience-of-art/ (scale, ethos)
- https://clotmag.com/interviews/the-wrong-biennale-exploring-the-unconventional ("act of faith," "non-elitist structure")
- https://www.wral.com/story/what-s-right-about-the-wrong-biennale-/17287288/ ("a website of websites")

**Aesthetic / net.art lineage + past works:**
- https://www.vice.com/en/article/jodi-something-wrong-is-nothing-wrong/ (JODI thesis)
- http://art.teleportacia.org/observation/vernacular/ (Lialina, "A Vernacular Web")
- https://www.theartstory.org/movement/internet-art/ (net.art history)
- https://www.arshake.com/en/a-walk-through-the-wrong-biennale/ (pavilion examples)
- https://www.domusweb.it/en/art/gallery/2023/11/22/the-wrong-biennale-pavilion-pink-berlin.html (Clusterduck "Deep Fried Feels")
- https://revistaarta.ro/en/converging-realities-desktop-studies-pavilion-at-the-wrong-biennale-2023/ (clean WebGL praised for "coherence")

*Caveats: thewrong.org and the Rhizome reviews block automated fetchers; the verbatim text above was captured via browser/search cache. "Guidelines subject to updates" — confirm dates on the live page before submitting.*

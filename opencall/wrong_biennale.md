# The Wrong Eclipse — Open Call Application Pack

> **⚠️ Deadline alert:** The submission deadline is **June 12, 2026 — today.** If you intend to submit, send your proposal email as soon as possible. Confirm the cutoff time directly with the organizers if you're close to the wire.

---

## 1. The Open Call at a Glance

**The Wrong Eclipse** is a 24-hour, web-based group exhibition organized by **The Wrong Biennale**, timed to unfold alongside the **total solar eclipse crossing Europe on August 12, 2026** — the first total eclipse visible in continental Europe since 1999. The premise: as the sun disappears, the exhibition showcases web-based works that "obscure certainty" (glitches, shadows, shared imaginaries) and "prototype hopeful utopias in the dark."

| Item                     | Detail                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Event name**           | The Wrong Eclipse                                                                                         |
| **Organizer**            | The Wrong Biennale (thewrong.org)                                                                         |
| **Curator**              | David Quiles Guilló                                                                                       |
| **Format**               | 24-hour online group exhibition, all web-based works                                                      |
| **Submission deadline**  | **June 12, 2026**                                                                                         |
| **Works must be online** | August 1–31, 2026                                                                                         |
| **Public showcase**      | August 12, 2026 (during the 24-hour eclipse window)                                                       |
| **Cost**                 | Free; no submission, registration, or exhibiting fees                                                     |
| **How to submit**        | Email a link to your proposal to **thewrongbiennale@gmail.com** with subject line **"The Wrong Eclipse"** |
| **Hosting**              | Artists host their own work and provide a link for review (and for the showcase if selected)              |

---

## 2. Curatorial Brief / What They're Looking For

The call seeks artworks that:

- **Embrace error and interruption** — work with glitch, breakage, and noise as material.
- **Misinterpret systems** — astronomical or otherwise; deliberate misreadings of how systems are "supposed" to work.
- **Exist temporarily, conditionally, or incorrectly** — time-based, unstable, or disappearing formats are explicitly welcomed.
- **Imagine new collective futures beyond visibility** — prototype "hopeful utopias in the dark."

Framing language from the call: _"Let the light go. Make something else appear."_ The tone leans toward **creativity, joy, wonder, and experimentation** — "let's make screens shine bright."

---

## 3. Requirements & Eligibility Checklist

Use this as a pre-submission checklist:

- [ ] **Work is web-based.** All works must be accessible on the web (no physical-only or app-store-gated pieces).
- [ ] **Online window covered.** The work must remain live and reachable from **August 1–31, 2026**.
- [ ] **Self-hosted link provided.** You host the work; you supply a URL for review and showcase.
- [ ] **Proposal emailed** to thewrongbiennale@gmail.com with the exact subject **"The Wrong Eclipse."**
- [ ] **Adult-only content clearly labeled** (if applicable).
- [ ] **Theme conforms.** Avoid themes centered on current news, hate, conflict, war, controversy, or violence. The call is celebratory and wonder-focused.
- [ ] **Not a commercial/crypto vehicle.** The Wrong is an art biennale, not a fair or NFT marketplace; pay-per-view, crypto-wallet requests, and other intrusive practices are not accepted.
- [ ] **Free participation acknowledged.** No fees are charged; none should be expected.

**Notes on guidelines:** The Wrong updates guidelines periodically for organizational improvement. Time-based, unstable, or disappearing formats are a feature, not a problem. Participation is voluntary, free, and open to all.

---

## 4. Suggested Submission Email

A simple text email is all that's required. Suggested structure:

```
To: thewrongbiennale@gmail.com
Subject: The Wrong Eclipse

Hi David and The Wrong team,

I'd like to submit the following web-based work to The Wrong Eclipse:

Title: Earth is the Oldest Stereoscope (2026)
Artist: Yufeng Zhao
Live link: https://stereoscope.yufeng.place
Code: https://github.com/yz3440/earth-is-the-oldeest-stereoscope
One line: A 3D video of the Moon recorded simultaneously from Boston and
Santiago during the 2026 lunar eclipse — the two halves of Earth become
the two eyes of a planet-scale stereoscope.

The work is web-based, self-hosted, and will remain online August 1–31, 2026.

[2–3 sentences on fit — see section 6.]

Best,
Yufeng Zhao
yufengzhao.com
```

> Confirm the live link works in a fresh browser and on mobile before sending, and that it will stay up through the end of August.

---

## 5. Your Project — Reference Summary

**Earth is the Oldest Stereoscope** (2026)
_Live:_ https://stereoscope.yufeng.place · _Code:_ https://github.com/yz3440/earth-is-the-oldeest-stereoscope

A computationally aligned stereo pair of the Moon, captured simultaneously from **Boston** and **Santiago** during the **lunar eclipse of March 2–3, 2026**. Two people, two rooftops, two identical Seestar S50 smart telescopes, one Moon. The baseline between cameras is ~4,864 mi (7,828 km) — more than half an Earth diameter — producing a real but tiny **1.18° parallax** at the Moon's ~236,685 mi (380,907 km) distance. The left eye sees Boston's telescope; the right eye sees Santiago's. The result is a view of the Moon no single observer on Earth can see.

**Concept / lineage:**

- Reframes **Nam June Paik's _Moon is the Oldest TV_ (1965)** — a natural object used as a technical medium. If the Moon is the oldest TV, Earth is the oldest stereoscope: when two people far apart look up at the same Moon, they become a pair of eyes separated by a continent.
- Builds on **Charles Wheatstone** (1838, horizontal disparity as the sole depth cue) and **Warren De la Rue** (c. 1858, first stereoscopic Moon photos, using _time_ and libration as his baseline). The new element is the synchronized, same-instant, opposite-hemisphere baseline.

**Technical pipeline (Python + TypeScript twin):**

- Phase-correlation tracking and stabilization; Moon cropped to 1080×1080.
- Calibration of drifting frame rate via ECC registration fitted to an analytical field-rotation model (observer lat/long + Moon's J2000 position), yielding per-frame UTC anchors (<1° residual).
- Per-frame **stereo roll** computed from observer geodetics and J2000 baseline so residual disparity is purely horizontal (the condition for binocular fusion).
- Compositing joins both sides on shared UTC timestamps.
- **Browser viewer** recomputes stereo math live in a WebGL2 fragment shader; outputs side-by-side, top-bottom, four anaglyph variants, and frame-sequential for active-shutter DLP-Link projectors. A Three.js scene renders the Earth–Moon–Sun geometry, itself stereoscopic.

**Tags:** stereoscopy, astronomy, telescope.

---

## 6. Why It Fits The Wrong Eclipse (Pitch Angles)

Strong alignment points to draw on in your submission note:

- **Eclipse-native.** The work was literally made _during_ an eclipse (the March 2026 lunar eclipse) and is about two hemispheres briefly agreeing the Moon is there. It speaks directly to an eclipse-timed, 24-hour show.
- **Misinterpreting astronomical systems.** The piece "misreads" the planet as an optical instrument — exactly the call's invitation to "misinterpret systems (astronomical or otherwise)."
- **Obscuring certainty / shadows.** It's built on shadow (eclipse umbra/penumbra), on a parallax so small it sits at the edge of perception, and on a Moon "no single observer can see."
- **Shared imaginaries / collective futures beyond visibility.** Two strangers on two rooftops, separated by half a planet, forming one gaze — a hopeful, collective image literally assembled in the dark.
- **Web-based and self-hosted.** Already meets the core technical requirement; the browser viewer runs anywhere.

**Tone check:** The piece is wonder-driven and celebratory rather than news/conflict-oriented, matching the call's "highlight wonder, make screens shine bright" spirit.

---

## 7. Artist Bio (for the submission)

**Yufeng Zhao** is a media artist and technologist based in Brooklyn, currently a graduate research assistant and MS candidate (expected 2027) in the **Future Sketches** group at the **MIT Media Lab**. His work addresses data, imagery/language processing, and experience design, exploring unexpected connections in our techno-cultural landscape and the interactions between humans and machines, across web-based experiences, video works, and tangible installations.

_Selected background:_ Senior Creative Technologist at Brilliant (2022–2025); Master of HCI, Carnegie Mellon (2022); BSc in Interactive Media Arts & Computer Science, NYU Shanghai (2020). Recent exhibitions include _Toolish Behavior_ (Clive Davis Gallery, Brooklyn, 2025) and _Caches from the Landscape_ (solo, SKOL, Montréal, 2025).

_Links:_ [Website](https://www.yufengzhao.com) · [GitHub](https://github.com/yz3440) · [Instagram](https://www.instagram.com/hallucitalgia/) · [Bluesky](https://bsky.app/profile/yufeng.bsky.social) · [LinkedIn](https://www.linkedin.com/in/yufeng-zhao/)

---

## 8. Source Links

- Open call (eclipse details): https://thewrong.org/ and https://thewrong.org/Eclipse
- The Wrong general guidelines / open call: https://thewrong.org/open-call
- Project page: https://www.media.mit.edu/projects/earth-is-the-oldest-stereoscope/overview/ · https://www.yufengzhao.com/projects/earth-is-the-oldest-stereoscope
- Live work: https://stereoscope.yufeng.place
- Artist: https://www.yufengzhao.com/about

_Compiled June 12, 2026. The Wrong updates its guidelines periodically — verify current details and the deadline cutoff time on thewrong.org before submitting._

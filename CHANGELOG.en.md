# Changelog

## 5.4.0 - 2026-10-14

Adds the **sprint period** and the **landing period**. During a high-intensity stretch such as proposal season, the daily record works against you: there are many fields, every field is a small decision, and once a day slips it is easy to drop the whole day and then weeks. The sprint period reduces the record to four protective anchors; the landing period brings the fields back one rung per day.

### Added

- **Sprint period**: declared once from the top of *Today*. Every day inside it records only four anchors: **lights off tonight** (the only required one, with a "lights off right now" shortcut), **woke up this morning**, **ate today** (a count only, empty by default), and **what moved forward today** (one personal item plus one line of research progress). Other fields are neither backfilled nor chased during this time.
- **Sprint days stay out of adherence**: records inside the period are stored with a *sprint* day state, excluded from trends and adherence while keeping the anchor data; lights-off adherence skips sprint ranges. Days already marked *chaotic* or *uncontrolled* are never relabelled retroactively.
- **Automatic close at the deadline**: the first time Xingzhou is opened after the last sprint day, the sprint is closed and the landing period starts — no extra click for something that was agreed when it was declared.
- **Landing period**: seven fixed rungs in a fixed order, one rung per day, and all three actions take effect **the next day** — *done* (advance), *not convenient today* (stay), *this rung is not needed* (skip). The day shows the rung that was recorded for that day.
  1. Write down the stopping point: is this delivery finished (done / partly / almost) plus what is still waiting (data, scripts, notes, the filtering process, reproduction steps)
  2. Wake-up time comes back
  3. Lights-off time comes back
  4. One work boundary comes back
  5. One personal block comes back
  6. Wrapping up the work environment
  7. Handing back and turning the page — the full record returns only after all seven rungs
- **Landing UI**: shows only what belongs to the current rung; the five-stage progress bar and the stage navigation are hidden so "dozens of items still missing" cannot loom. The banner states today's rung and that "seven days is a rhythm, not a deadline".
- **Sprint days in history**: a neutral chip marks days that fall inside a sprint period.

### Changed

- *Today* gains an *enter sprint period…* entry point; inside a sprint it shows *extend to…* (the end date is the only thing that can change) and *end sprint period*.
- Ending a sprint reminds you to create a *tidy up* task in SiYuan Task Center for the intermediate artefacts (data, scripts, the filtering process). Xingzhou does not create that task itself.
- Overlays (declare, extend, end, backfill) are now portalled to `document.body`, so an ancestor with `container-type` can no longer trap `position: fixed` and misplace them.

### Fixed

- The whole record form used to disappear during the landing period: the form shared a "not sprint and not landing" condition with the five-stage progress bar, leaving only the banner and making every click appear to do nothing.
- Completing a rung used to advance the same day to the next rung: the displayed rung and the visible fields now come from the rung recorded for that day instead of the cursor.
- The sprint UI no longer disappears when a date other than today is open; neither it nor the landing banner depends on `isToday` any more.
- The *delivery result* panel no longer lingers until rung 4: it belongs to rung 1 only.

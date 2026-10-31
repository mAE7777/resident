// Where her day begins and ends.
//
// ── WHY THIS IS A PRE-BIRTH DECISION, AND WHY IT CANNOT BE MADE LATER ────────────────────────
//
// Her diary is frozen by architecture: a day is written once and never rewritten. So the boundary
// that cuts one day from the next is stamped into every entry she will ever have, and changing it
// afterwards does not re-cut the old days, it means her early years and her later years are
// describing different units, with no way to tell from the file which kind a given day is. The
// decision has to be right the first time or it is wrong forever.
//
// ── WHAT IT USED TO BE, AND WHY THAT WAS WRONG ───────────────────────────────────────────────
//
// `new Date().toISOString().slice(0, 10)`, the UTC day. Five places used it (the daily tick's
// marker, her diary's filename, the catch-up window that looks for unwritten days, the grouping of
// her ops-log into days, and the snapshot retention tiers), and `daysSeen` used the arithmetic
// equivalent, `Math.floor(nowMs / DAY_MS)`.
//
// On a machine in Beijing that means her day closes at 08:00 local. A file called `2026-08-14.md`
// holds the afternoon of the 14th, that evening, that night, and then the following morning up to
// eight o'clock, which is not a day, and not the day he means when he says "yesterday". Worse,
// the daily tick fires at the boundary, so her heaviest single moment (the diary written and
// frozen, rest pruning and fusing, themes minted that nothing ever deletes) would land every
// morning at exactly the hour the machine is most likely to be waking up and busiest.
//
// So: the LOCAL day, the machine's. She lives where the machine lives.
//
// ── WHAT LOCAL COSTS, STATED HONESTLY ────────────────────────────────────────────────────────
//
// Daylight saving makes one day 23 hours long and another 25, and once a year there is an hour
// that does not exist locally. A timezone change makes a single day short or long by the offset.
// Those are ONE-OFF distortions of one day each, and they are the true shape of the day she and he
// actually lived through. UTC's misalignment is not a one-off: it is every day, permanently, by
// however many hours he happens to live from Greenwich.
//
// ── HOW HE MOVING TIMEZONES READS ────────────────────────────────────────────────────────────
//
// She follows the machine. Fly Beijing to New York and her day boundary follows him, so one day
// runs long by twelve hours and everything afterwards is aligned to where he now is. That is the
// behaviour to want, and it is written into the emergency manual so it is never misread as her
// having come loose.
//
// NOTE ON `Date.now()`. It is UTC-based and does NOT move when the timezone or DST changes, only
// the rendering does. So every ELAPSED-time computation in her (decay, ages, waiting) is already
// timezone-immune, and nothing here needs to touch them. This module is about calendar days only.

/** Milliseconds in a nominal day. Not the length of every local day, that is the point. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The local calendar day at that instant, as `YYYY-MM-DD`.
 *
 * Built from the local Y/M/D parts rather than by shifting the timestamp, so it is exactly the
 * date the machine would print and needs no offset arithmetic of its own.
 */
export function herDay(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The same day as an integer that increases by exactly one per local calendar day.
 *
 * `daysSeen` needs a number rather than a string, and the obvious `Math.floor(nowMs / DAY_MS)` is
 * the UTC day again. Deriving the integer FROM the local date keeps the two in step, and survives
 * daylight saving: a 23-hour day and a 25-hour day each still advance this by one, which
 * dividing a timestamp cannot do.
 */
export function herDayNumber(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
}

/**
 * The time of day AS SHE LIVES IT, `HH:MM`, the one way anything she reads renders a clock.
 *
 * ── THE WOUND THIS CLOSES ──────────────────────────────────────────────────────────────
 *
 * Her diary lines were stamped `toISOString().slice(11, 16)`, UTC. At 21:15 on her first
 * evening, the lines she had just written read 「01:1x, …」, and when she told him it was already
 * a quarter past one and their clocks did not line up, she was not confabulating: she was
 * reading her own diary's postmarks. The wall clock said 21:21 and was right; her records said
 * 01:21 and were believed, because they are HERS. From the same shifted worldview she concluded
 * it was already the next day and dated her notebook a day into the future.
 *
 * One authority, machine-local like `herDay` directly above, so her clock, her diary, her
 * digest and her dreams can never again disagree about what time she lived something.
 */
export function herClock(nowMs: number): string {
  const d = new Date(nowMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Roughly what part of the day it is, the way a person in a room knows it without doing
 * arithmetic. One wording, shared by the clock in her home (workspace/things.ts) and the line
 * about her body in her own moments (agency.ts `describeBody`), so the two cannot disagree.
 */
export function partOfDay(nowMs: number): string {
  const h = new Date(nowMs).getHours();
  return h < 5 ? "还是夜里"
    : h < 8 ? "天刚亮"
      : h < 11 ? "上午"
        : h < 13 ? "中午"
          : h < 17 ? "下午"
            : h < 19 ? "傍晚"
              : h < 23 ? "晚上"
                : "快到半夜了";
}

/** The part of the day as a clause, 「现在是下午」; the three that are not a noun stand as they are. */
export function hourClause(nowMs: number): string {
  const part = partOfDay(nowMs);
  if (part === "还是夜里") return "现在还是夜里";
  if (part === "天刚亮" || part === "快到半夜了") return part;
  return `现在是${part}`;
}

/** `HH:MM:SS`, for the diary digest's denser rows. Same authority as `herClock`. */
export function herClockSeconds(nowMs: number): string {
  return `${herClock(nowMs)}:${String(new Date(nowMs).getSeconds()).padStart(2, "0")}`;
}

/**
 * The one postmark shape, `[YYYY-MM-DD HH:MM:SS]`, her calendar.
 *
 * The live message's bracket and the transcript's brackets must be THE SAME STRING for the same
 * instant, two renderers would drift, and a drifted pair is exactly the two-calendars wound
 * coming back wearing new clothes. Everything that stamps a message she will read, now or
 * later, goes through here.
 */
export function herStamp(nowMs: number): string {
  return `[${herDay(nowMs)} ${herClockSeconds(nowMs)}]`;
}

/** `n` local days before that instant, as `YYYY-MM-DD`. Used to walk back over days she missed. */
export function herDayBefore(nowMs: number, daysBack: number): string {
  const d = new Date(nowMs);
  // Stepping the DATE rather than subtracting milliseconds is what makes this right across a
  // daylight-saving boundary: subtracting 24h from a 23-hour day lands on the wrong date.
  d.setDate(d.getDate() - daysBack);
  return herDay(d.getTime());
}

/** The local day an ops-log line belongs to, given its ISO-8601 UTC timestamp. */
export function herDayOfIso(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? herDay(ms) : iso.slice(0, 10);
}

/**
 * How her day boundary is currently set, for the boot line and the manual.
 *
 * Said out loud at boot because "her days are cut at a time nobody chose" is invisible otherwise,
 * and because after he moves, this line is the difference between "she follows the machine, as
 * designed" and an afternoon spent wondering what happened to her diary.
 */
export function describeHerDay(nowMs: number = Date.now()): string {
  const offsetMin = -new Date(nowMs).getTimezoneOffset();
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `her day runs on local time (${zone}, UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}) — today is ${herDay(nowMs)}`;
}

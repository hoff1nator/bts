# Test Clock for BTS and BUP

## Goal

BTS should be able to run against a manipulated application time for testing.
This should allow us to simulate:

- "today" and date-based filters
- planned times and delayed/on-time states
- warmup and pause timers
- automatic calling logic
- certificate export defaults
- display and tablet views that depend on current time

The operating system time should not be changed.
Instead, BTS should use an application-level clock abstraction.
BUP should stay on normal wall-clock time as long as possible.

## Scope

### Phase 1: BTS only

Introduce a central BTS clock and route all time-sensitive server logic through it.

This already helps for:

- server-side scheduling logic
- export filters
- date-dependent UI defaults
- data shown to clients when derived on the server

### Phase 2: BUP integration

Allow BTS to cooperate with BUP while BUP itself remains unchanged.
This is done by translating timestamps at the BTS/BUP boundary.

## Recommended model

Use a single clock service with three modes:

- `real`
- `fixed`
- `offset`

### `real`

Use the actual current time.

### `fixed`

Always return one exact timestamp.

Example:

- `2026-04-19T13:45:00+02:00`

Useful for deterministic screenshots and debugging.

### `offset`

Return real time plus/minus a configured offset.

Examples:

- `+1 day`
- `-3 hours`

Useful when the system should still "move forward" naturally.

## BTS design

### New module

Add a dedicated server-side module, for example:

- `/home/tim/repos/bts/bts/clock.js`

Responsibilities:

- store current clock mode
- return `now_ms()`
- return `new Date(now_ms())`
- format current effective time for admin/debug output
- persist and restore clock settings

### Suggested API

```js
clock.get_mode()
clock.get_now_ms()
clock.get_now_date()
clock.set_real()
clock.set_fixed(timestamp_ms)
clock.set_offset(offset_ms)
clock.describe()
```

Optional helpers:

```js
clock.today_iso_local(timezone)
clock.to_effective_date(input)
clock.to_real_ts(timestamp_ms)
clock.to_effective_ts(timestamp_ms)
```

## Persistence

Store the clock state in a small dedicated collection or in global admin settings.

Recommended shape:

```js
{
  _id: "global_clock",
  mode: "real" | "fixed" | "offset",
  fixed_ts: 1776512700000,
  offset_ms: 86400000,
  updated_ts: 1776426300000
}
```

Reasons:

- survives restart
- easy to inspect
- easy to reset to real time

## Current implementation status

This section reflects the current codebase state.

### Implemented

- BTS has a central clock service in [clock.js](/home/tim/repos/bts/bts/clock.js)
- clock state is persisted in the `app_settings` collection
- admin handlers expose and update the clock state
- tournament payloads include `test_clock`
- several server-side scheduling and automation paths now use `app.clock`
- BTS/BUP timestamp translation is implemented at the BTS/BUP boundary

### Admin/UI support

Clock state can be read and changed from BTS admin code.
The current clock state is also attached to the tournament response as:

```js
tournament.test_clock
```

### BTS/BUP boundary model

We currently do not want to modify BUP itself.

Instead, BTS translates timestamps when talking to BUP:

- BTS internal effective time:
  used by scheduling, automation, preparation logic, certificate defaults, and similar server-side behavior
- outgoing BTS -> BUP timestamps:
  translated back to real wall-clock time
- incoming BUP -> BTS timestamps:
  translated from real wall-clock time back to BTS effective time

This keeps BUP on its normal clock while still allowing BTS to simulate time.

## Files currently involved

The following files are part of the current test-clock implementation or were adjusted to use it:

- [clock.js](/home/tim/repos/bts/bts/clock.js)
- [database.js](/home/tim/repos/bts/bts/database.js)
- [bts.js](/home/tim/repos/bts/bts/bts.js)
- [admin.js](/home/tim/repos/bts/bts/admin.js)
- [ctournament.js](/home/tim/repos/bts/static/js/ctournament.js)
- [change.js](/home/tim/repos/bts/static/js/change.js)
- [match_automation.js](/home/tim/repos/bts/bts/match_automation.js)
- [match_utils.js](/home/tim/repos/bts/bts/match_utils.js)
- [btp_conn.js](/home/tim/repos/bts/bts/btp_conn.js)
- [btp_sync.js](/home/tim/repos/bts/bts/btp_sync.js)
- [btp_proto.js](/home/tim/repos/bts/bts/btp_proto.js)
- [ticker_conn.js](/home/tim/repos/bts/bts/ticker_conn.js)
- [bupws.js](/home/tim/repos/bts/bts/bupws.js)
- [http_api.js](/home/tim/repos/bts/bts/http_api.js)

## Where BTS should use the clock

We should replace direct `Date.now()` / `new Date()` usage in time-sensitive paths.

### High-priority server paths

- automatic court assignment / auto-call logic
- match preparation timing
- pause and warmup related server logic
- BTP sync decisions based on "recent" timestamps
- export defaults that use "today"
- any logic that computes match status from current time

These are now largely routed through `app.clock`.

### Lower-priority paths

- logging timestamps
- purely informational diagnostics
- file naming

Those can stay on real wall-clock time if needed.

### Intentionally still on real time

Some places should continue to use real wall-clock time:

- [update_queue.js](/home/tim/repos/bts/bts/update_queue.js)
  runtime measurement for queue diagnostics
- ID generation that must stay monotonic and collision-safe
- the real-time reference inside [clock.js](/home/tim/repos/bts/bts/clock.js)

The code still contains a few `Date.now()` fallbacks in helper functions.
Those are intentional safety nets for cases where no explicit BTS clock value is available.

## Admin / UI control

Provide a small admin panel section:

- mode: `Real time`, `Fixed`, `Offset`
- fixed datetime input
- offset input in minutes or hours
- reset button
- current effective time preview

Suggested actions:

- `Use real time`
- `Freeze at current time`
- `Set fixed datetime`
- `Shift by +1h / +1d / -1h / -1d`

## Client synchronization

If the browser also needs the same simulated time, BTS should expose clock state to clients.

Suggested tournament payload addition:

```js
tournament.test_clock = {
  mode: "fixed",
  effective_now_ms: 1776512700000,
  real_now_ms: 1776426300000,
  offset_ms: 0
}
```

This allows browser code to derive a consistent "now".

## BUP integration

### Goal

BUP should continue to work without direct clock changes.

### Preferred approach

Translate relevant timestamps at the BTS/BUP boundary.

Current boundary strategy:

- when BTS sends timestamps to BUP, BTS converts from effective time to real time
- when BUP sends timestamps back to BTS, BTS converts from real time to effective time

Relevant examples:

- `called_timestamp`
- `preparation_call_timestamp`
- `needs_preparation_successor_ts`
- `end_ts`

This logic currently lives in [bupws.js](/home/tim/repos/bts/bts/bupws.js).

### Why this approach

- BUP can stay untouched
- live systems remain simpler
- the BTS test clock can still drive server-side decisions
- preview and panel behavior stay close to production BUP behavior

### Limits of the current approach

- if BUP contains logic based on its own local `Date.now()`, that logic still uses real wall-clock time
- only timestamp-based interactions that pass through BTS can be shifted safely
- if we ever need full simulated-time rendering inside BUP itself, BUP will need its own clock abstraction

## Important constraint

Do not monkey-patch global `Date` in browser or Node.

Reasons:

- hard to reason about
- breaks libraries unpredictably
- difficult to debug
- creates hidden coupling between BTS and BUP

A local clock service is much safer.

## Rollout plan

### Step 1

Introduce `bts/clock.js` with persistence and tests.

Status: done

### Step 2

Replace high-priority `Date.now()` usage in BTS server logic.

Status: mostly done

### Step 3

Translate timestamps at the BTS/BUP boundary instead of modifying BUP.

Status: done

### Step 4

Keep a small practical workflow for testing and debugging with `real`, `fixed`, and `offset`.

Status: done

## Practical test flows

The following examples describe the intended usage from an operator or developer perspective.

### 1. Real time

Use this for normal operation.

Expected setup:

- clock mode = `real`
- BTS and BUP both behave as in production

Typical checks:

- current-time dependent filters use the real current date
- preparation and auto-call logic behave normally
- BUP panels and BTS server decisions stay aligned with real time

Use this mode after finishing any test session.

### 2. Fixed time

Use this when you want a deterministic test snapshot.

Example:

- set clock mode = `fixed`
- set fixed timestamp = `2026-04-19 13:45`

Good use cases:

- reproducing a specific tournament day
- testing certificate export defaults for one known day
- checking scheduled/preparation state at one exact time
- reproducing auto-call decisions without waiting in real time

Typical checks:

- BTS admin/tournament payload shows the expected `test_clock`
- date-based exports and filters use the fixed day
- scheduling logic behaves exactly as if BTS time were frozen there
- BUP still runs on its own real clock, but timestamp-based BTS interactions remain coherent

### 3. Offset time

Use this when time should continue to move forward naturally.

Examples:

- `+1 day`
- `+2 hours`
- `-30 minutes`

Good use cases:

- checking “tomorrow” behavior without freezing time
- simulating that a scheduled match is now late or due soon
- testing pause expiry and readiness logic while time still advances

Typical checks:

- BTS effective time moves continuously
- rules based on “now” react as if BTS were shifted
- long-running tests remain realistic because time keeps moving

### 4. Suggested verification checklist

After changing the clock mode, verify at least these points:

- tournament admin data shows the expected `test_clock`
- date-based filters use the expected effective day
- preparation or auto-call candidates change as expected
- certificate export defaults use the intended date
- BUP score/timer related payloads still work without direct BUP changes

### 5. Recommended reset procedure

After testing, always switch back to:

- mode = `real`

Then confirm:

- new admin payloads report real time again
- exports use the real current date
- no operator-facing screen still depends on a stale fixed/offset clock

Status: done

### Step 4

Keep low-level runtime diagnostics and technical ID generation on real time where appropriate.

Status: done

### Step 3

Expose effective clock state in admin UI and tournament/client payloads.

### Step 4

Add BUP-side clock abstraction.

### Step 5

Switch BUP timer- and preview-relevant code to that abstraction.

## Minimal first implementation

If we want a fast first version, we can start with:

- BTS server-side clock only
- admin controls
- no BUP integration yet

This already gives value for:

- server logic
- exports
- API results
- reproducible scheduling/debugging

Then we add BUP support afterwards.

## Recommendation

Build this in two stages:

1. BTS clock abstraction and persistence
2. BUP clock compatibility

That keeps risk manageable and gives us a useful testing tool early.

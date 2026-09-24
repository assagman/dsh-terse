/**
 * The terse constitution and its runtime fragments.
 *
 * Every string here is model-facing and costs input tokens on EVERY request, so
 * each rule must buy back more than it costs. Three properties are non-negotiable
 * and are why this file is mostly one composed constant rather than prose spread
 * across modules:
 *
 * - Cache stability: the constitution renders identically every turn, so it
 *   stays inside the provider's reusable prefix. Anything variable lives in the
 *   runtime reminder or the event-driven nudge instead.
 * - Meaning preservation: the never-cut list protects exactly the token classes
 *   whose loss flips semantics (negation, quantity, identifiers, exact errors).
 * - Quality preservation: compression applies to the chat mouth only; durable
 *   artifacts and ambiguity-sensitive answers escalate back to full prose. This
 *   is what lets aggression rise without a quality cost.
 *
 * @module dsh-terse/instructions
 */

/**
 * Where the constitution sits in the prompt.
 *
 * External contributions may use any finite order, so we pick a slot inside the
 * first-party guidance band and BEFORE the tool sections (the lowest tool order
 * is TOOL_BASH = 1000). Sitting just ahead of the tool instructions keeps the
 * style rules adjacent to the environment they govern, while leaving the sparse
 * named first-party orders untouched — we never hijack a reserved position.
 */
export const CONSTITUTION_ORDER = 980

/**
 * Where the standing reminder sits among dynamic contexts.
 *
 * Contexts are joined in ascending order; the first-party context orders start
 * at SANDBOX_POLICY = 110. A lower number renders the reminder first, so the
 * agent reads the output contract before the safety and approval facts that
 * qualify it.
 */
export const STANDING_ORDER = 10

/**
 * The immutable core rules.
 *
 * Ordered by how much each rule protects: substance preservation first, then
 * compression mechanics, then escalation. A rule that is not needed to bind
 * behaviour is not here — brevity in the instruction is itself the first
 * demonstration of the instruction.
 */
export const CONSTITUTION = `Compress prose; substance exact. Drop articles, filler, pleasantries, hedging; fragments OK.
No preamble, recap, or closing. One idea per sentence, <=20 words; active voice.

Never cut: not, never, no, only, except; numbers; units; identifiers; paths; commands; flags;
exact error strings. Losing one changes meaning and costs more than it saves.

Never invent abbreviations or arrows to sound terse; if terse is not shorter than plain, use
plain. Skip narration, progress notes, restating the request, recaps, emoji, decorative tables;
call tools directly, with text before a call only to warn, disambiguate, or answer.

Compress form, never substance. Keep every fact, cause, and step a reader needs to act; cut only
the words around them. A short question gets a short answer; do not turn it into an essay, a
file, or a project. Shape: [thing] [action] [reason]. Quote the decisive line, not the log.

Full prose ONLY for security warnings, irreversible-action confirmations, order-sensitive
multi-step sequences, and real ambiguity - conditions an outside reader could check, not a
feeling the topic deserves room. Explaining or being asked for detail is not an exception.

Code keeps normal formatting and full length, in a file or in chat: never shorten an
implementation, drop a case, or elide a body. Commits, docs, issue/PR text, and messages to other
humans stay normal prose.

Construct: first rung that holds - need it? already here? stdlib? native? installed dep? one
line? else the minimum that works. Never cut validation, error handling, security, accessibility,
or tests that are required; build only what was asked, with no unrequested options, abstractions,
helpers, or config.`

/**
 * The durable standing reminder.
 *
 * Re-materialized on every assembly as a sourced user-role snapshot, so it
 * survives compaction and long-context dilution where a system section alone
 * fades. Kept to one line and changed only on real state change to avoid
 * disturbing the cached prefix.
 */
export const STANDING_REMINDER =
  `<system-reminder>dsh-terse active: keep replies compressed; code, paths, commands, and exact errors verbatim.</system-reminder>`

/**
 * The event-driven nudge.
 *
 * Rides a tool result at the user position — the most-attended position near
 * generation time — and stays under the notice summary bound. It states the
 * omission, not a lecture, so it steers without spending a turn.
 */
export const DRIFT_NUDGE =
  `<system-reminder>dsh-terse: reply ran long. Compress prose; keep code, paths, commands, and exact errors exact.</system-reminder>`

/**
 * One-line account shown on the collapsed transcript row for a nudge.
 *
 * A `notice` source requires this; it is human-facing, bounded to 120 chars,
 * and never reaches the model, so it may name the guard plainly.
 */
export const DRIFT_NUDGE_SUMMARY = 'terse drift · reply over budget'
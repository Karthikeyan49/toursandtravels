# Operations Guide

A walkthrough of a booking's life in the system, written for the agency's own staff — sales, operations,
accounts — not for developers. It describes the intended end-to-end workflow the system is built for.

> **Status note, read this first.** The backend (everything described below as an API call) is built and
> working. The screens described below — the actual buttons and forms a staff member would click — are **not
> built yet**: `frontend/src/pages/` is empty. Until those pages exist, every step below can be done by a
> developer using the API directly (with `curl` or a tool like Postman/Insomnia), but not by staff through a
> browser. This guide describes the workflow the screens will implement; see
> [REQUIREMENTS.md §3](../REQUIREMENTS.md) for the honest, itemised build status of each screen. One step —
> the printable itinerary handout — has no backend support yet either; it is marked below.

There is **no customer-facing login**. Everything in this guide is done by agency staff on behalf of the
customer, who only ever sees what staff hand them: a quote, a booking confirmation, an itinerary, an invoice.

---

## 1. Capture an enquiry

Someone calls, walks in, or messages on WhatsApp asking about a trip. A **sales** staff member opens the
Enquiries screen and logs it as a new Lead — contact name and phone, where they heard about the agency (Lead
Source: Walk-in / WhatsApp / Instagram / Referral / …), which destination they're asking about, roughly when
they want to travel, how many adults/children/infants, and a free-text note of what they actually said they
want.

The enquiry now shows up on the sales pipeline as **New**. If a call or message doesn't immediately turn into a
firm request, that's fine — log a follow-up (channel, outcome, next action, next due date) and move on; the
lead sits in **Contacted** until it's ready to be quoted, and a dashboard reminder nudges a salesperson if a
lead goes 48 hours with no follow-up logged against it.

## 2. Build a quotation with the toggle builder

Once there's enough to price, open **New Quotation** from the lead. Most of the customer's details (name,
phone, destination, dates, pax count) carry over automatically — nobody retypes them.

This is the "Dynamic Quotation Builder" the client asked for by name. Every choice below is a simple toggle or
dropdown, not a form field the customer has to interpret — sales sets these based on what the customer said
they want, and the system prices and prints accordingly:

- **Package type** — is this a **Full Package** (everything included: travel + stay + food) or an
  **Independent/Individual** booking (just a flight, just a hotel, just a visa — whatever the customer
  specifically asked for)? This is the `quote_type` choice, and it stays consistent with the booking that gets
  opened from this quote later — the vocabulary is shared end to end.
- **Transport mode** — Flight, Train, Bus, or Mixed (some legs by air, some by road). If the trip has no
  transport component at all (say, a hotel-only booking), leave it as "None."
- **Hotel category** — Budget, 2-Star, 3-Star, 4-Star, or 5-Star. (2-Star was added specifically because the
  client's own hotel contracts include 2-star properties that the system didn't originally have a slot for.)
- **Room type** — Normal, AC, Non-AC, Deluxe, Super Deluxe, Executive, or Suite.
- **Food** — toggle Included / Excluded, and if included, pick the dietary style: Vegetarian, Non-Vegetarian,
  **Brahmin Food**, or Jain Food. (Brahmin Food is a dietary tag communicated to the caterer/hotel kitchen —
  the system does not run a separate meal-prep approval workflow for it; see REQUIREMENTS.md §5 if this
  assumption turns out to be wrong for how the agency actually sources Brahmin meals.)
- **Add-ons** — four independent switches: extra Baggage allowance (with a free-text note, e.g. "one extra
  check-in bag per pax"), Local Transport at the destination (pickup/drop, sightseeing transfers), Sightseeing
  included, and Travel Insurance included. Each is informational today — turning one on records that the
  customer was promised it, but does not, on its own, add a priced line to the quote. If the destination or
  activity has its own catalogue entry (a sightseeing package, an insurance product with a real premium), price
  that separately as a normal quotation line the way any other service is priced.

Below the toggles, price the trip itself — either pull the price straight from a packaged tour's rate card
(pick the package, the travel date, and the occupancy — the system looks up the right slab and fills in the
numbers; nobody types a sell price by hand for a catalogued package), or build it up line by line for a custom
itinerary (hotel nights, transfers, activities — each priced from its own rate card the same way).

The quote is a **draft** until it's ready. Nothing changes toggles or prices on a quote that has already been
sent — revising a sent quote creates a new numbered version instead, so what the customer actually saw is
never silently rewritten later.

## 3. Send it, and track the response

Mark the quote **Sent** once it's gone out to the customer (WhatsApp, email, printed — however the agency
actually delivers it). The dashboard's sales-funnel view is exactly the metric the client asked for: total
enquiries, total quotes sent, how many are still awaiting a response, and how many converted — a live count,
not a spreadsheet someone has to update.

When the customer replies, record the outcome plainly: **Accepted** or **Rejected** (with a reason, if given —
"too expensive," "chose a competitor," "postponed travel," whatever it actually was; this feeds the
lead-source ROI report over time). A rejected quote can still be revised and re-sent if the customer comes back
with a different budget or different dates.

## 4. Convert to a booking

Once the customer says yes, **Convert to Booking** turns the quote into a firm booking in one action. Every
toggle chosen in step 2 — package type, transport mode, hotel category, room type, food and diet, every add-on
switch — travels forward onto the booking automatically. Nobody re-enters any of it. The commercial numbers
(what the customer is being charged, what it costs the agency) carry over the same way.

If a detail needs to change after conversion — say the customer later upgrades from AC to Deluxe rooms — that's
a deliberate edit on the live booking, not a side effect of reopening the original quote, and it's recorded in
the booking's own history so there's a record of what was promised versus what was actually delivered.

## 5. Enter passengers

Fill in the passenger manifest: name, whether adult/child/infant, and — for anyone travelling internationally —
passport number, expiry, and visa status. The system checks passport expiry automatically against the return
date and warns if a passport is going to expire too soon after the trip (most countries want six months'
validity beyond the travel dates) or if a visa is still pending or was rejected — so a document problem shows
up before departure day, not at the airport.

## 6. Enter the actual travel logistics once tickets are issued

This is separate from the pricing step in §2/§4 on purpose: at quote time there usually isn't a PNR yet — the
customer hasn't been ticketed. Once flights, trains, or buses are actually booked and tickets are in hand,
operations enters the real logistics as **travel legs**, one row per leg of the journey:

- Mode (flight/train/bus/car), direction (onward/return/somewhere in the middle of the trip)
- Carrier name and the actual flight/train/bus number
- PNR
- Exact departure and arrival dates and times, from and to
- The finalised baggage allowance for that specific ticket (which may differ from what was promised at quote
  time if the fare class changed)

Mark a leg **Confirmed** once the PNR is in hand. A leg that the customer books themselves (say, they already
had a flight and just need it on their itinerary sheet) still gets an entry here even though it was never a
priced item on the booking — this table is about what's on the ticket, not what was billed.

## 7. Assign a local driver and vehicle

For pickup, drop-off, and sightseeing at the destination, assign a vehicle and a driver to the booking for the
relevant date range — the driver's name and phone number are what end up on the customer-facing handout (see
§8) and on the driver's own dispatch. This is unrelated to the travel-legs step above; it was already fully
built before this pass, because it's how the ops board has always worked.

## 8. Hand the customer a printable itinerary

**Not built yet.** The intent is a single, clean document — physical printout or PDF — compiling everything
the customer needs before they travel: the day-by-day plan, the actual flight/train/bus numbers and timings
from step 6, the hotel and room details, and the assigned driver's name and phone number from step 7. All of
that data now exists and is fully wired in the backend; what's missing is the button that renders it. See
REQUIREMENTS.md §3 (T11) for the current state.

## 9. Take payment

Record payments against the booking as they come in — an advance to confirm the booking, then instalments as
agreed, right through to the balance before departure. Every payment gets a mode (cash, bank transfer, UPI,
cheque, card) and, for anything traceable, a reference number for reconciliation. The booking's balance updates
itself after every payment; nobody has to track "how much is still owed" by hand, and it is never possible to
accidentally record more than what's actually outstanding — the system checks the live balance at the moment
the payment is saved, even if two people are entering payments on the same booking at the same time.

If a payment was entered wrong, it gets **voided** with a reason, not deleted — the mistake and its correction
both stay on the record.

## 10. Raise the right kind of bill

The agency can issue two different kinds of billing document for the same booking, and the system keeps them
strictly separate — a customer never receives one document that mixes GST and non-GST treatment:

- **GST Tax Invoice** — for a customer who needs one. GST is computed automatically (split into CGST+SGST if
  the customer is in the same state as the agency, or IGST if not), and the invoice draws its number from the
  regular invoice sequence.
- **Non-GST Cash Bill** — for a customer who just wants a plain receipt with no tax component. No GST is
  computed at all, and it draws its number from its own separate sequence, so a cash bill can never be
  confused with, or accidentally numbered like, a tax invoice.

A booking can have one of each if needed (unusual, but the system allows it), but never two of the same kind
side by side, and a bill of either kind is voided rather than edited if it turns out to be wrong.

> One open question for the agency to confirm: should a Non-GST cash bill carry its own printed disclaimer
> line (e.g. "This is not a tax invoice; input tax credit is not available") — see REQUIREMENTS.md §5.

## 11. Track the trip on the ops board

Once confirmed, the booking generates a day sheet for every day of the trip — a simple checklist ops can tick
through as the day happens (hotel checked in, transfer done, sightseeing done, next hotel checked in, …). If
something goes wrong on the ground — a hotel downgrade, a delayed flight, a medical issue — log it as an
incident with a severity, so it's visible to management immediately and gets a resolution recorded rather than
being handled verbally and forgotten.

## 12. Close it out

Mark the booking **Completed** once the trip is over. At that point the margin on the booking — what the
customer paid versus what it actually cost the agency, once every supplier bill for that trip is in — is
available without anyone building a spreadsheet: actual supplier bills are used where they exist, falling back
to the original estimate only for anything not yet billed, so the margin figure never looks artificially
perfect just because a supplier hasn't invoiced yet.

Cancelling a booking instead of completing it is its own guarded action — the cancellation charge is computed
automatically from the agency's slab policy (e.g. 10% if cancelled 30+ days out, up to 100% inside 48 hours),
never typed in by hand, and any refund due is capped at what the customer actually paid in.

---

## Who does what (role reference)

| Role | Typically does |
|---|---|
| **Sales** | Enquiries, quotations, converting to bookings |
| **Operations** | Passenger manifest, travel legs, driver/vehicle assignment, ops board, vouchers, incidents |
| **Accounts** | Payments, invoices, cash bills, supplier bills, expense approval, P&L |
| **Manager** | Everything sales + operations does, plus pricing overrides and cancellations |
| **Owner** | Everything, plus user management, company settings, and the audit log |
| **Visa** | Passport/visa status on the passenger manifest |

Full detail on exactly which action is restricted to which role is in [SECURITY.md](../SECURITY.md).

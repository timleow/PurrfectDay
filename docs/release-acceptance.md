# Release acceptance criteria

These criteria turn the family-tracker decisions from the product conversation into checks that can be repeated before a release. Apple sign-in is explicitly out of scope for this release.

## Navigation and family management

- **NAV-1:** The app has a persistent, labeled bottom navigation with Care, Cats, and Family tabs. The selected tab is exposed accessibly.
- **NAV-2:** Care opens the care tracker, Cats opens the cat overview, and Family opens family and people settings. The dark/light toggle remains available in the care header.
- **CATS-1:** The Cats view summarizes each cat’s daily food progress, play count, and weekly ear care, and clearly indicates the currently selected cat.
- **CATS-2:** A user can add a cat, change its photo, edit its name, remove it, and open its Care tracker from the Cats view.
- **FAM-1:** The Family view focuses on the current family settings and people management, and includes a compact list of the family’s cats with a route to full cat management in the Cats tab.
- **FAM-5:** Each family member’s email is displayed on its own line below their name.
- **FAM-6:** A person’s Remove action aligns to the right edge of their row.
- **FAM-2:** Family view loading shows a loading state until family and people have loaded.
- **FAM-3:** A signed-in user can remove another family member. Removing the current signed-in member is not offered.
- **AUTH-1:** Google sign-in is available. Apple sign-in is absent from this release's sign-in UI and setup copy.
- **FAM-4:** Family timezone is assigned from the device during family creation and cannot be edited as free text in the family view.

## Care tracking

- **CARE-1:** A numeric +1 check-in exposes an undo action to the member who made it. Undo reverses that check-in and records the reversal.
- **CARE-2:** A wet-food +10% check-in exposes an undo action to the member who made it. Undo restores both can count and partial progress, including when a tap completed a can.
- **CARE-3:** The count in “Now tap to track” keeps a fixed-height, tabular-number slot as its value changes, including when the count gains a digit.
- **CARE-4:** The “Who fed?” count matches the tracked food amount, including partial wet-food progress, while its detail card retains individual check-in entries.
- **CARE-5:** Undo is a small curved-arrow control at the upper-left of the tap card and is offered only after a check-in.
- **CARE-6:** Undo belongs to the member who made the check-in. It reverses only that check-in's amount, preserving later family updates to the same tracker; it records a compensating care entry rather than deleting shared history.
- **SYNC-1:** Realtime changes are debounced so a burst of shared updates triggers one refresh after activity settles; the app does not poll on a fixed interval.
- **GOAL-1:** Daily food goals can be edited without the dialog closing or the value being overwritten while typing; changes are applied when the user confirms.
- **PHOTO-1:** The cat photo/avatar is prominent in the selected-cat mobile picker and the larger tracker avatar.
- **PHOTO-2:** The add-cat photo picker presents a “Choose file!” control without the browser’s default no-file text.

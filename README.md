# Spelling Time

Spelling activities for PLD Stages 2–6: word list (tap a word for its pop-up), phonic passage, spelling tests (Easy/Hard), definitions quiz (Easy/Hard), cloze (Easy/Hard), editing passage and dictation. Student results, student passwords, teacher-set stages and activities, and supermarket purchases are stored in a Google Sheet.

## Files

| File | What it is | When to edit it |
|---|---|---|
| `src/App.tsx` | App state and navigation | For new top-level workflows |
| `src/features/` | Authentication, activities, progress, store, and teacher screens | For feature work |
| `src/api.ts` | Typed Google Sheets requests | When the Apps Script API changes |
| `src/curriculum.ts` | PLD JSON adapters, loaded with the learning screens | Only if curriculum loading changes |
| `src/input.css`, `src/styles.css` | Locally-built Tailwind and app styling | For visual changes |
| `data/config.json` | Google Sheet web app URL | If the web app URL changes |
| `data/` | Sharded class, PLD, word, supermarket, and dictionary datasets | When source data changes |
| `version.json` | Release metadata | When preparing a hosted release |

`apps-script/Code.gs` is the Google Apps Script. **Don't upload it to GitHub**: once your teacher password is in it, it belongs only in the Google Sheet (Extensions → Apps Script).

## Workflows

Students sign in with their room, name, and password. The learning screen uses the assigned PLD stage and selected term/week to provide word lists, passages, spelling practice, definitions, cloze, editing, and dictation. Results are sent to the Google Sheet. Progress and supermarket purchases are available from the workspace navigation.

The teacher workspace supports stage assignments, term activity settings, and class progress. Bonus games use the selected week's list: Spellsa reveals a word by letter, Ice Blocks accepts dictionary words, and Let it Go is a timed spelling round.

## Word pop-up

In **Word List**, a student taps a word to hear it and open its pop-up. The pop-up shows the word in its PLD colours, followed by Definition, Part of Speech, Synonyms, Antonyms, Root, Word family, and Prefixes and Suffixes. Anything that doesn't apply shows **n/a**. The pop-up scrolls on its own if it is taller than the screen, and closes with **Close** or a tap outside it.

The pop-up text lives in `data/word-info-shards/`; the app loads these word records when the word list opens and falls back to `data/content-shards/` for a definition.

## Build and release

Run `npm run build` to create the production site in `dist/`. Publish that directory with GitHub Pages. Keep the private Apps Script source and teacher password out of the repository. `version.json` remains release metadata; the app bundle no longer uses the legacy in-app version checker.

## Updating the Apps Script

1. Open the old Code.gs and copy your teacher password.
2. Paste the new `Code.gs` over everything, then put your password into `TEACHER_PASSWORD` at the top.
3. **Deploy → Manage deployments →  Edit → Version: New version → Deploy.** The URL stays the same.

## If logins stop working

1. **Test the Apps Script:** paste the web app URL from `data/config.json` into a browser. It should show `{"service":"PLD Spelling Activities", ... "ok":true}`.
2. **"couldn't be found (error 404)"** or a Google error page: in Apps Script go to **Deploy → Manage deployments**. Copy the **Web app URL** of the active deployment and make sure `data/config.json` has exactly that URL. If you made a *New deployment* instead of editing the existing one, the URL will have changed.
3. **"sent back a web page instead of data"**: in the deployment settings, *Execute as* should be **Me** and *Who has access* should be **Anyone**.
4. **"That password is not right"** for the teacher: check `TEACHER_PASSWORD` at the top of Code.gs, then deploy a new version.
5. **"The Google Sheet didn't answer"**, **"took too long to answer"** or **"is busy with lots of students at once"**: see the next section.

## When the whole class uses it at once

Google Apps Script limits concurrent requests. The app uses `studentSync` when available and falls back to separate stage/activity requests for older deployments. Network and server errors are shown in the workspace; use the retry control or check **Executions** in Apps Script if a request continues to fail. Avoid redeploying Apps Script during class use.

## Student passwords

- The first time a student logs in, they make a password (at least 4 characters) and type it twice. They're told to choose one they'll remember and to write it down somewhere safe.
- After that, they type the password every time they log in.
- Passwords are kept in the **Passwords** tab. **To reset a forgotten password,** delete it from the Password cell. The student will be asked to make a new one the next time they log in.

## Set Activities (teacher)

Teacher → **Set Activities** → choose a term → untick activities to hide them from students for that term → **Confirm** → confirm twice.

Medals use only the assessed activities that are switched on:

| Medal | Needs at 100% |
|---|---|
| Gold | all of them |
| Silver | 60%, rounded up |
| Bronze | 30%, rounded up |

With all 6 switched on, that's 2 / 4 / 6. The Apps Script remains the source of truth for medal calculations and rewards.

Changing a term's activities recalculates medals and **restocks every student's supermarket** (all Fremantium given back). This doesn't use up anyone's daily fridge Reset.

## Fremantium and the supermarket

- A student earns Fremantium the first time they reach each medal in a week: 3, +5, +10. That makes 18 for a gold week.
- The balance appears in the Supermarket view. The Sheet works it out as *earned from medals − spent*.
- **Supermarket:** 6 aisles (tabs), each with 4 shelves. The dearest items are on the top shelf and the cheapest are on the bottom. There's one of each item, 96 in total.
- The prices add up to **648**, which is 36 weeks × 18. So a student can only buy everything by getting gold in every week of the year.
- **My fridge:** shows the items currently owned and the balance available for another purchase.
- **Reset** puts everything back on the shelves and gives all the Fremantium back. **Each student can use Reset once a day.** After that the button is greyed out with a note saying they can reset again tomorrow. Each use is logged in the **Resets** tab. "A day" follows the Google Sheet's time zone (**File → Settings → Time zone**), so check it is set to Perth. To give a student another Reset today, delete their row for today from the Resets tab.
- The Sheet restocks a student's purchases automatically if their balance would go below zero (e.g. a stage change archives results) or if `version` in `data/supermarket.json` changes.

## Hosting on GitHub Pages

1. Build the site with `npm run build`.
2. Configure Pages to publish the generated `dist/` artifact using GitHub Actions.
3. Keep `apps-script` and other private credentials out of the published artifact.

The browser tab and the iPad home-screen icon are both named **Spelling Time**.

## Google Sheet tabs (created automatically)

- **Stages**: Term, Room, ClassNumber, Student, Stage, UpdatedAt (one row per student per term)
- **Results**: one row per finished assessed activity (Easy/Hard spelling test, definitions, cloze)
- **ArchivedResults**: results moved out of *Results* when a teacher changes a student's stage for that term
- **Passwords**: Room, ClassNumber, Student, Password, UpdatedAt
- **Activities**: Room, Term, Activities (the switched-on activities), UpdatedAt. No row for a term means every activity is on.
- **Purchases**: Room, ClassNumber, Student, ItemId, Price, CatalogVersion, Timestamp
- **Resets**: Room, ClassNumber, Student, Day, Timestamp (one row each time a student uses the fridge Reset)

## Local development
Run `npm ci`, then `npm run dev` and open `http://127.0.0.1:4173`. Stop the server with Ctrl+C.

Run `npm run check` for TypeScript validation, `npm run build` for a production build, and `npm test` for Playwright browser tests. Install the local browser once with `npx playwright install chromium`; CI installs it automatically.

App code lives in `src/` and is split into React features, shared components, and typed API/data adapters. Raw curriculum datasets remain in `data/`.

# PLD Spelling Activities

Spelling activities for PLD Stages 2–6: word list, phonic passage, spelling tests (Easy/Hard), definitions quiz (Easy/Hard), cloze (Easy/Hard), editing passage and dictation. Student results, student passwords, teacher-set stages and activities, and supermarket purchases are stored in a Google Sheet.

## Files

| File | What it is | When to edit it |
|---|---|---|
| `index.html` | The page itself | Rarely |
| `css/styles.css` | Look and layout | To change colours or sizes |
| `js/app.js` | How the app works | For new features |
| `js/config.js` | Google Sheet link | If the web app URL changes |
| `data/class-list.js` | Rooms and students | When your class changes |
| `data/pld-data.js` | PLD word lists, week index and passages | Only if the PLD data changes |
| `data/content.js` | Definitions and cloze sentences | As each stage is added |
| `data/supermarket.js` | Supermarket aisles, items and prices | To change the food (add 1 to `version` when you do) |
| `version.json` | The newest app version number | Every time you upload an update |

`apps-script/Code.gs` is the Google Apps Script. **Don't upload it to GitHub**: once your teacher password is in it, it belongs only in the Google Sheet (Extensions → Apps Script).

## Releasing an update (version check)

When someone presses a login button (student **That's me** or teacher **Log in**), the app checks `version.json` on GitHub. If the iPad is running an older copy, a pop-up asks them to tap **Update the app**. That button re-downloads every app file and reloads the page.

When Claude makes an update, it changes the version number for you, so there's nothing to do. You only need these steps if you edit files yourself. Every time you upload changed files to GitHub:

1. Pick a new version number, e.g. `2026-10-02.1`.
2. Put it in **`version.json`**: `{ "version": "2026-10-02.1" }`
3. Put the same number in **`js/app.js`**, near the top: `const APP_VERSION = '2026-10-02.1';`

If the two don't match, everyone gets the update pop-up every time they log in, so always change both. If the check can't run (e.g. no internet), login carries on as normal.

## Updating the Apps Script

1. Open the old Code.gs and copy your teacher password.
2. Paste the new `Code.gs` over everything, then put your password into `TEACHER_PASSWORD` at the top.
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The URL stays the same.

## If logins stop working

1. **Test the Apps Script:** paste the web app URL from `js/config.js` into a browser. It should show `{"service":"PLD Spelling Activities", ... "ok":true}`.
2. **"couldn't be found (error 404)"** or a Google error page: in Apps Script go to **Deploy → Manage deployments**. Copy the **Web app URL** of the active deployment and make sure `js/config.js` has exactly that URL. If you made a *New deployment* instead of editing the existing one, the URL will have changed.
3. **"sent back a web page instead of data"**: in the deployment settings, *Execute as* should be **Me** and *Who has access* should be **Anyone**.
4. **"That password is not right"** for the teacher: check `TEACHER_PASSWORD` at the top of Code.gs, then deploy a new version.

## Student passwords

- The first time a student logs in, they make a password (at least 4 characters) and type it twice. They're told to choose one they'll remember and to write it down somewhere safe.
- After that, they type the password every time they log in.
- Passwords are kept in the **Passwords** tab. **To reset a forgotten password,** delete it from the Password cell. The student will be asked to make a new one the next time they log in.

## Set Activities (teacher)

Teacher → **Set Activities** → choose a term → untick activities to hide them from students for that term → **Confirm** → confirm twice.

Medals use only the medal activities (the 🏅 ones) that are switched on:

| Medal | Needs at 100% |
|---|---|
| 🥇 Gold | all of them |
| 🥈 Silver | 60%, rounded up |
| 🥉 Bronze | 30%, rounded up |

With all 6 switched on, that's 2 / 4 / 6, the same as before. To change the percentages, edit `SILVER_PERCENT` and `BRONZE_PERCENT` in **both** `js/app.js` and `Code.gs`.

Changing a term's activities recalculates medals and **restocks every student's supermarket** (all Fremantium given back).

## Fremantium and the supermarket

- A student earns Fremantium the first time they reach each medal in a week: 🥉 3, 🥈 +5, 🥇 +10. That makes 18 for a gold week.
- The balance is always in the top bar. The Sheet works it out as *earned from medals − spent*.
- **Supermarket:** 6 aisles (tabs), each with 4 shelves. The dearest items are on the top shelf and the cheapest are on the bottom. There's one of each item, 96 in total.
- The prices add up to **648**, which is 36 weeks × 18. So a student can only buy everything by getting gold in every week of the year.
- **Fridge:** each aisle has its own compartment (freezer, top shelf, middle shelf, fruit drawer, veggie drawer, door shelves). Items not bought yet show as grey silhouettes. **Reset** puts everything back on the shelves and gives all the Fremantium back.
- The Sheet restocks a student's purchases automatically if their balance would go below zero (e.g. a stage change archives results) or if `version` in `data/supermarket.js` changes.

## Hosting on GitHub Pages

1. Create a repository and upload everything in this folder **except `apps-script`** (keep the `css`, `js` and `data` folders).
2. **Settings → Pages**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`, then Save.
3. The site appears at `https://<username>.github.io/<repository>/` after a minute or two.

## Google Sheet tabs (created automatically)

- **Stages**: Term, Room, ClassNumber, Student, Stage, UpdatedAt (one row per student per term)
- **Results**: one row per finished assessed activity (Easy/Hard spelling test, definitions, cloze)
- **ArchivedResults**: results moved out of *Results* when a teacher changes a student's stage for that term
- **Passwords**: Room, ClassNumber, Student, Password, UpdatedAt
- **Activities**: Room, Term, Activities (the switched-on activities), UpdatedAt. No row for a term means every activity is on.
- **Purchases**: Room, ClassNumber, Student, ItemId, Price, CatalogVersion, Timestamp

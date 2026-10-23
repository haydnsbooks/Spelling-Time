# Spelling Time

Spelling activities for PLD Stages 2–6: word list (tap a word for its pop-up), phonic passage, spelling tests (Easy/Hard), definitions quiz (Easy/Hard), cloze (Easy/Hard), editing passage and dictation. Student results, student passwords, teacher-set stages and activities, and supermarket purchases are stored in a Google Sheet.

## Files

| File | What it is | When to edit it |
|---|---|---|
| `index.html` | The page itself | Rarely |
| `css/styles.css` | Look and layout | To change colours or sizes |
| `js/app.js` | How the app works | For new features |
| `js/config.js` | Google Sheet link | If the web app URL changes |
| `data/class-list.js` | Rooms and students (Rooms 8, 9, 10, 11, 12 and 16) | When a class changes or a room is added |
| `data/pld-data.js` | PLD word lists, week index and passages | Only if the PLD data changes |
| `data/content.js` | Definitions and cloze sentences for every week of Stages 2–6 | To change a definition or sentence |
| `data/word-info.js` | The word pop-up for every list word in Stages 2–6 (emoji, definition, part of speech, synonyms, antonyms, root, word family, prefixes and suffixes) | To change what a word's pop-up says |
| `data/supermarket.js` | Supermarket aisles, items and prices | To change the food (add 1 to `version` when you do) |
| `data/dictionary.js` | Real words allowed as guesses in Ice Blocks | To allow an extra word (add it to `EXTRA`) |
| `version.json` | The newest app version number | Every time you upload an update |

`Code.gs` is the Google Apps Script. **Don't upload it to GitHub**: once your teacher password is in it, it belongs only in the Google Sheet (Extensions → Apps Script).

## Open Student Activities (teacher, for the smartboard)

Teacher → **Open Student Activities** opens the pages students see, with everything unlocked:

- Choose any **term**, **stage** and **week**, then **Show the activities**. Every activity is shown, even ones switched off in Set Activities.
- The top bar shows **Teacher view ▾ / Term ▾ / Stage ▾ / Week ▾**, so you can jump anywhere. **Teacher view ▾ → Back to teacher page** returns to the teacher menu.
- Nothing is saved: results don't go to the Google Sheet or the device, there are no medals or Fremantium, and the Supermarket, Fridge and Progress buttons are hidden.
- The **Bonus Zone** button is always there in teacher view. Its games use every word in the chosen stage from Term 1 up to the chosen week.

## Bonus Zone

When a student gets **gold** for a week, a flashing **⚡ BONUS ZONE ⚡** button appears in the top right of that week's activities page. The games are just for fun and use every word from every list the student has had this year: all 9 weeks of earlier terms (in the stage they had that term) plus this term up to the week they're on.

- **Spellsa**: tap letters to find the word before the picture of Spellsa (a girl in a light blue dress) is finished. 6 lives: each wrong letter adds her head, hair, dress, left arm, right arm, then shoes. 💡 Hint shows the definition.
- **Streaks (Spellsa and Ice Blocks):** 🔥 **Streak** counts words solved in a row and goes back to 0 when a word is lost. 🏆 **Best streak** is the student's highest. Both are kept on that iPad only, separately for each game.
- **Ice Blocks**: like Wordle. Find the secret word (4 to 8 letters, letters only) in 6 tries. **Every guess must be a real word**, so a mash of letters is turned away without using up a row. **Cyan** is the right letter in the right spot, **powder blue** is in the word but in the wrong spot, and **snow white** is not in the word. 💡 Hint shows the definition. The real-word check uses `data/dictionary.js` (an Australian English word list) plus every spelling list word. To allow an extra word, add it to `EXTRA` at the bottom of that file.
- **Let it Go**: a powder blue balloon is let go and climbs through the sky, past the clouds and into space. The iPad says a word (with the cloze sentence as a clue) and the student spells it on the on-screen keyboard.
  - The timer starts at **60 seconds**. Each correct word adds **3 seconds** (and gives the balloon a lift). **Skip** takes away 3 seconds. A wrong answer costs nothing, as long as it's a genuine guess (students are told this; behind the scenes the app won't check an answer shorter than 3 letters, or the whole word for 2-letter words).
  - The balloon climbs 10 m every second and 20 m for every correct word, so the longer a student keeps spelling correctly, the higher it goes. Space starts at about 1,250 m.
  - The **Height** counter shows how high the balloon is now, with the student's **Highest** climb above it. Each student's highest climb is kept on that iPad only.
  - All three numbers (60, 3 and 3) are in `LIG` near the top of the Bonus Zone section of `js/app.js`.

Bonus games don't send anything to the Google Sheet and don't earn medals or Fremantium.

## Word pop-up

In **Word List**, a student taps a word to hear it and open its pop-up. The pop-up shows the word (in its PLD colours) with emojis, then Definition, Part of Speech, Synonyms, Antonyms, Root, Word family and Prefixes and Suffixes. Anything that doesn't apply shows **n/a**. The pop-up scrolls on its own if it is taller than the screen, and closes with ✕, **Close** or a tap outside it.

The pop-up text lives in `data/word-info.js`, one line per word. The first lines of that file explain each field. If a word's line is missing, the pop-up still opens and uses the definition from `data/content.js`.

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
4. Reload the Google Sheet once. A **Spelling Time** menu appears next to Help (see *If you edit the sheet by hand* below).

## If logins stop working

1. **Test the Apps Script:** paste the web app URL from `js/config.js` into a browser. It should show `{"service":"PLD Spelling Activities", ... "ok":true}`.
2. **"couldn't be found (error 404)"** or a Google error page: in Apps Script go to **Deploy → Manage deployments**. Copy the **Web app URL** of the active deployment and make sure `js/config.js` has exactly that URL. If you made a *New deployment* instead of editing the existing one, the URL will have changed.
3. **"sent back a web page instead of data"**: in the deployment settings, *Execute as* should be **Me** and *Who has access* should be **Anyone**.
4. **"That password is not right"** for the teacher: check `TEACHER_PASSWORD` at the top of Code.gs, then deploy a new version.
5. **"The Google Sheet didn't answer"**, **"took too long to answer"** or **"is busy with lots of students at once"**: see the next section.

## When lots of students use it at once

Google lets the Apps Script run at most **30 requests at the same time** for one Google account, and because the web app runs as you (*Execute as: Me*), every iPad's requests count towards your account, across every class using the app. When too many arrive together, Google turns the extra ones away and the app can't read why. The app and the Apps Script do three things to stay under that limit.

**1. Fewer requests from each iPad**

- Each student screen (activities menu, trophy cabinet, supermarket, fridge) gets everything it needs in **one request** (`studentSync`). Opening another screen within **1 minute** reuses that answer instead of asking again. The student's own new results and medals still show straight away, because the iPad already knows about them.
- **Finished activities are saved in batches.** A result is kept on the iPad (so the tile turns green and the medal shows straight away) and sent to the Google Sheet **45 to 90 seconds later**, together with any other activities finished in the meantime. Each iPad picks its own random moment, so a class finishing together doesn't all send at once. Results also go with any other request the student's screens make, and are sent straight away when the student opens the **supermarket** or **fridge** (so the Fremantium from them can be spent) or **logs out**. If the iPad is offline or the sheet is busy, they wait on the iPad and are tried again a minute or two later, and again next time the app opens.
- An iPad never sends more than 2 requests at once, and the activities menu and trophy cabinet wait a random moment (up to 3 seconds) so a whole class opening the app together doesn't all ask in the same second.

Because of the batching, **See Student Progress can be up to about 2 minutes behind** what students have just finished. Tap **Refresh** to load it again.

**2. Retries spread out**

A request that fails because the sheet is busy or didn't answer is **tried again automatically** (up to twice) before the student sees a message. The wait before each retry is random and gets longer each time (about 1.5 to 6 seconds, then 4 to 16 seconds), so a whole class doesn't try again at the same moment.

**3. Faster answers from the Apps Script**

The slowest thing the Apps Script does is read a whole tab, and the Results tab grows all year. So the Apps Script now keeps **saved copies** (Google's CacheService) of what each student's screens need: their best score for each activity, their purchases and Reset day, and each room's stages and activity settings. It only reads the sheet when a copy is missing, and Google keeps a copy for at most 6 hours. Every change made through the app (saving results, buying, Reset, setting stages or activities) updates the saved copies straight away. Saving results also no longer reads the whole Results tab first. Shorter requests mean fewer are running at the same moment.

Only requests that change the sheet (saving results, buying, Reset, passwords, teacher changes) wait their turn to write. Reading never waits. The teacher's **See Student Progress** page still reads the Results tab itself, so it is always up to date with what has been saved.

To check the saved copies are working, open the web app URL in a browser: it shows `"cache":"on"`.

If a message keeps appearing when only a few students are on, open **Executions** in Apps Script to see the failed runs and their error.

## If you edit the sheet by hand

Because of the saved copies, a change you make **directly in the Google Sheet** (for example deleting some results, or changing a stage in the Stages tab instead of using Set Student Stages) may not show in the app for up to 6 hours. To make it show straight away, use the menu **Spelling Time → Refresh the app's saved copies** in the Google Sheet. The first time, Google asks you to allow the script to run: choose your account and allow it.

The Apps Script also tries to do this automatically whenever the sheet is edited by hand, but Google may not allow that kind of automatic trigger to reach the saved copies, so use the menu to be sure.

- **Clearing a student's password** doesn't need the menu: passwords are always read straight from the sheet.
- **Deleting a student's row in the Resets tab** (to give them another Reset today) does need the menu afterwards.
- Anything done through the app, teacher pages included, never needs it.

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

Changing a term's activities recalculates medals and **restocks every student's supermarket** (all Fremantium given back). This doesn't use up anyone's daily fridge Reset.

## Fremantium and the supermarket

- A student earns Fremantium the first time they reach each medal in a week: 🥉 3, 🥈 +5, 🥇 +10. That makes 18 for a gold week.
- The balance is always in the top bar. The Sheet works it out as *earned from medals − spent*.
- **Supermarket:** 6 aisles (tabs), each with 4 shelves. The dearest items are on the top shelf and the cheapest are on the bottom. There's one of each item, 96 in total.
- The prices add up to **648**, which is 36 weeks × 18. So a student can only buy everything by getting gold in every week of the year.
- **Fridge:** each aisle has its own compartment (freezer, top shelf, middle shelf, fruit drawer, veggie drawer, door shelves). Items not bought yet show as grey silhouettes.
- **Reset** puts everything back on the shelves and gives all the Fremantium back. **Each student can use Reset once a day.** After that the button is greyed out with a note saying they can reset again tomorrow. Each use is logged in the **Resets** tab. "A day" follows the Google Sheet's time zone (**File → Settings → Time zone**), so check it is set to Perth. To give a student another Reset today, delete their row for today from the Resets tab, then use **Spelling Time → Refresh the app's saved copies**.
- The Sheet restocks a student's purchases automatically if their balance would go below zero (e.g. a stage change archives results) or if `version` in `data/supermarket.js` changes.

## Hosting on GitHub Pages

1. Create a repository and upload everything in this folder (keep the `css`, `js` and `data` folders). Don't upload `Code.gs`.
2. **Settings → Pages**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`, then Save.
3. The site appears at `https://<username>.github.io/<repository>/` after a minute or two.

The browser tab and the iPad home-screen icon are both named **Spelling Time**.

## Google Sheet tabs (created automatically)

- **Stages**: Term, Room, ClassNumber, Student, Stage, UpdatedAt (one row per student per term)
- **Results**: one row per finished assessed activity (Easy/Hard spelling test, definitions, cloze)
- **ArchivedResults**: results moved out of *Results* when a teacher changes a student's stage for that term
- **Passwords**: Room, ClassNumber, Student, Password, UpdatedAt
- **Activities**: Room, Term, Activities (the switched-on activities), UpdatedAt. No row for a term means every activity is on.
- **Purchases**: Room, ClassNumber, Student, ItemId, Price, CatalogVersion, Timestamp
- **Resets**: Room, ClassNumber, Student, Day, Timestamp (one row each time a student uses the fridge Reset)

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
| `data/pld-data.js` | PLD word lists, week index, weekly focus and passages | To change a passage or a week's focus (see *Weekly focus and passages*) |
| `data/content.js` | Definitions and cloze sentences for every week of Stages 2–6 | To change a definition or sentence |
| `data/word-info.js` | The word pop-up for every list word in Stages 2–6 (emoji, definition, how the word is used in each part of speech, synonyms, antonyms, root, word family, prefixes and suffixes) | To change what a word's pop-up says |
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

## Relief Teacher log in

For a relief teacher using the app in a lesson. On the teacher log in, choose **Relief Teacher** at the bottom of the **Select room** list and type the password from `RELIEF_PASSWORD` at the top of `Code.gs`.

- It goes straight to **Open Student Activities** (described above), for any term, stage and week. **Log out** is on that page and under **Relief teacher ▾** in the top bar.
- There's no teacher page, so no Set Student Stages, Set Activities, See Student Progress or Reset a Password.
- The Apps Script checks this password separately from the teacher passwords, so it won't open a room in the teacher log in or work for any teacher action.
- To change the password, edit `RELIEF_PASSWORD` in `Code.gs` and deploy a new version (see *Updating the Apps Script*).

## Bonus Zone

When a student gets **gold** for a week, a flashing **⚡ BONUS ZONE ⚡** button appears in the top right of that week's activities page. The games are just for fun and use every word from every list the student has had this year: all 9 weeks of earlier terms (in the stage they had that term) plus this term up to the week they're on.

- **Spellsa**: tap letters to find the word before the picture of Spellsa (a girl in a light blue dress) is finished. 6 lives: each wrong letter adds her head, hair, dress, left arm, right arm, then shoes. 💡 Hint shows the definition.
- **Streaks (Spellsa and Ice Blocks):** 🔥 **Streak** counts words solved in a row and goes back to 0 when a word is lost. 🏆 **Best streak** is the student's highest. Both are kept on that iPad only, separately for each game. A word can't be skipped by reloading the page or leaving the game: if a word was shown and not finished, the streak goes back to 0 the next time the student opens that game, with a message saying why.
- **Ice Blocks**: like Wordle. Find the secret word (4 to 8 letters, letters only) in 6 tries. **Every guess must be a real word**, so a mash of letters is turned away without using up a row. **Cyan** is the right letter in the right spot, **powder blue** is in the word but in the wrong spot, and **snow white** is not in the word. 💡 Hint shows the definition. The real-word check uses `data/dictionary.js` (an Australian English word list) plus every spelling list word. To allow an extra word, add it to `EXTRA` at the bottom of that file.
- **Let it Go**: a powder blue balloon is let go and climbs through the sky, past the clouds and into space, while helicopters, flying pigs, hot-air balloons, flying cars and buses, UFOs with aliens, comets, rockets, astronauts and a space cow zoom past. The iPad says a word (with the cloze sentence as a clue) and the student spells it on the on-screen keyboard.
  - The balloon starts **100% full** of air (it can't go above 100%). It leaks **1% a second**, and the leak grows by **0.2% a second every 10 seconds**. Each correct word adds **3%** of air. A wrong answer lets out **1.5%** (the same half-of-a-correct-word penalty as the Snowman) and **Skip** lets out 3%. Behind the scenes the app won't check an answer shorter than 3 letters, so tapping Check on one or two letters does nothing. The balloon shrinks as it loses air, and at **0%** it whizzes about and falls: game over.
  - The balloon climbs 10 m every second and 20 m for every correct word. Space starts at about 1,250 m.
- **Do You Wanna Build a Snowman?**: the questions from **Definitions Quiz 2** (read the meaning, type the word), using every word from the student's lists this year. A snowman stands in the sun with **50 hp**. It melts **0.5 hp a second**, and melts **0.1 hp a second faster every 10 seconds**. A correct word rebuilds **2 hp**; a wrong answer or a skip melts **1 hp**. The snowman droops, drips and shrinks as it melts and pops back up when rebuilt. At **0 hp** it's a puddle: game over. The score is how long the snowman lasted.
- **Troll Rolling**: the questions from **Cloze Activity 2** (type the word that fits the gap). A moss troll curled into a ball rolls down an endless hill at **10 m/s**. It slows **0.1 m/s every second**, and slows **0.02 m/s faster every 10 seconds** (the Snowman numbers scaled to start at 10 instead of 50). A correct word adds **0.4 m/s**; a wrong answer or a skip takes away **0.2 m/s**. At **0 m/s** the troll stops and sits up, dizzy: game over. The score is how far it rolled.
- All the game numbers are in `LIG`, `SNOW` and `TROLL` near the top of the Bonus Zone section of `js/app.js`. Each student's all-time best in each game is kept on that iPad.

### Weekly high scores

Every bonus game shows three high scores for **this week** under its button in the Bonus Zone, and on the game's own screen. The Bonus Zone pages can be scrolled by tapping and dragging, including with a mouse or on the smartboard (a drag doesn't count as tapping a button). The boards cover Monday to Sunday, in the Google Sheet's time zone:

- **Stage 4 Rm 9**: the best student on the same stage in the same room
- **Stage 4 Whole School**: the best student on the same stage in any room
- **All Stages Whole School**: the best student in the whole school (name only)

The scores are: Let it Go and Troll Rolling, metres; Snowman, time lasted; Spellsa and Ice Blocks, the longest streak (sent when a streak ends or the student leaves the game). Scores are saved in the **HighScores** tab of the Google Sheet, but only when a student beats their own best for the week, so the sheet isn't written to after every game. Teacher view shows the high scores but never adds to them. High scores need the updated `Code.gs` (see *Updating the Apps Script*).

Bonus games don't earn medals or Fremantium.

## Word pop-up

In **Word List**, a student taps a word to hear it and open its pop-up. The pop-up shows the word (in its PLD colours) with emojis, then Definition, Part of Speech, Synonyms, Antonyms, Root, Word family and Prefixes and Suffixes. Anything that doesn't apply shows **n/a**. The pop-up scrolls on its own if it is taller than the screen, and closes with ✕, **Close** or a tap outside it.

The pop-up text lives in `data/word-info.js`, one line per word. The first lines of that file explain each field. If a word's line is missing, the pop-up still opens and uses the definition from `data/content.js`.

The **Part of Speech** row explains how the word is used in each part of speech, e.g. *Noun: A monitor is a screen for a computer. Verb: To monitor something means to keep looking at it and checking it carefully.* These sentences are in the `u` field of each line in `data/word-info.js`.

## Weekly focus and passages

The top of **Word List** shows the week's focus, from these fields of each week in `data/pld-data.js`:

- `f`: the focus, checked against the words in that week's list. Weeks with no single sound (sight words, homophones, multi-syllable words) say so.
- `m`: what the prefix or suffix means, if the list has one. Leave it out if not.
- `c` and `n` are the PLD teaching sequence's own wording. They are kept for reference, but students don't see them.

Weeks where the PLD teaching sequence says to create your own passage now have one (`ps` is `written`). Each passage has `c` (the correct text, also used for the phonic passage and dictation) and `e` (the editing version, with 15 mistakes).

## Releasing an update (version check)

When someone presses a login button (student **That's me** or teacher **Log in**), the app checks `version.json` on GitHub. If the iPad is running an older copy, a pop-up asks them to tap **Update the app**. That button re-downloads every app file and reloads the page.

When Claude makes an update, it changes the version number for you, so there's nothing to do. You only need these steps if you edit files yourself. Every time you upload changed files to GitHub:

1. Pick a new version number, e.g. `2026-10-02.1`.
2. Put it in **`version.json`**: `{ "version": "2026-10-02.1" }`
3. Put the same number in **`js/app.js`**, near the top: `const APP_VERSION = '2026-10-02.1';`

If the two don't match, everyone gets the update pop-up every time they log in, so always change both. If the check can't run (e.g. no internet), login carries on as normal.

## Updating the Apps Script

1. Open the old Code.gs and copy your teacher password, the relief password (and any room passwords in `ROOM_PASSWORDS`).
2. Paste the new `Code.gs` over everything, then put your password into `TEACHER_PASSWORD` at the top, the relief password into `RELIEF_PASSWORD` (and the room passwords back into `ROOM_PASSWORDS`).
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The URL stays the same.
4. Reload the Google Sheet once. A **Spelling Time** menu appears next to Help (see *If you edit the sheet by hand* below).

## If logins stop working

1. **Test the Apps Script:** paste the web app URL from `js/config.js` into a browser. It should show `{"service":"PLD Spelling Activities", ... "ok":true}`.
2. **"couldn't be found (error 404)"** or a Google error page: in Apps Script go to **Deploy → Manage deployments**. Copy the **Web app URL** of the active deployment and make sure `js/config.js` has exactly that URL. If you made a *New deployment* instead of editing the existing one, the URL will have changed.
3. **"sent back a web page instead of data"**: in the deployment settings, *Execute as* should be **Me** and *Who has access* should be **Anyone**.
4. **"That password is not right"** for the teacher: check `TEACHER_PASSWORD` at the top of Code.gs, and the room's line in `ROOM_PASSWORDS` if it has one, then deploy a new version. For **Relief Teacher**, check `RELIEF_PASSWORD`.
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
- Passwords are kept in the **Passwords** tab.

### Resetting a forgotten password (teacher)

Teacher → **Reset a Password** → choose the student → **Reset password** → confirm.

- Only the students in the room you logged into are listed. Students who haven't made a password yet show **(no password yet)** and can't be reset.
- Their old password stops working straight away. The next time they log in, they make a new one (the same as their first log in).
- A student who is still logged in on an iPad stays logged in there until they log out.
- You can still reset a password by hand: delete it from the Password cell in the **Passwords** tab.

### Teacher passwords for each room

The Apps Script checks the teacher password against the room being opened, so a teacher can only reset passwords (and set stages, set activities or see progress) for a room whose password they know.

- `TEACHER_PASSWORD` at the top of `Code.gs` opens **every room that isn't listed in `ROOM_PASSWORDS`**.
- To keep a class to its own teacher, give that room its own password in `ROOM_PASSWORDS`, spelt exactly as in `data/class-list.js`, e.g. `'Room 10': 'their-password',`. That room then opens **only** with its own password, and its teacher can't open any other room with it.
- While rooms share `TEACHER_PASSWORD`, anyone who knows it can choose any of those rooms at login.
- After changing `ROOM_PASSWORDS`, deploy a new version (see *Updating the Apps Script*).

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
- **HighScores**: Week (the Monday), Timestamp, Game, Room, ClassNumber, Student, Stage, Score (one row each time a student beats their own best for the week in a bonus game). Old weeks can be deleted by hand; then use *Spelling Time → Refresh the app's saved copies*.

## Student names

Students are listed by **first name and last initial** only (e.g. *Sunny B.*), in `data/class-list.js` (`firstName`, `lastInitial`, `displayName`). That's the name on the log in list, in the high scores and in the Google Sheet. To shorten names in rows saved before 2026-11-18, use **Spelling Time → Shorten student names** in the Google Sheet once (after deploying the 2026-11-18.2 `Code.gs`). It matches each row by room and class number to the names in `SHORT_NAMES` near the bottom of `Code.gs`; add new students there when a class list changes. If two students in a room would get the same name, give them two letters (*Jordan Le.* and *Jordan La.*).

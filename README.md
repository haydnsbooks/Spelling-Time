# PLD Spelling Activities

Spelling activities for PLD Stages 2–6: word list, phonic passage, spelling tests (Easy/Hard), definitions quiz (Easy/Hard), cloze (Easy/Hard), editing passage and dictation. Student results and teacher-set stages are stored in a Google Sheet.

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

The Google Apps Script code (`Code.gs`) is **not** part of this folder on purpose: it contains the teacher password and belongs only in the Google Sheet.

## Hosting on GitHub Pages

1. Create a repository and upload everything in this folder (keep the `css`, `js` and `data` folders).
2. **Settings → Pages**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`, then Save.
3. The site appears at `https://<username>.github.io/<repository>/` after a minute or two.

## Google Sheet tabs (created automatically)

- **Stages**: Term, Room, ClassNumber, Student, Stage, UpdatedAt (one row per student per term)
- **Results**: one row per finished assessed activity (Easy/Hard spelling test, definitions, cloze)
- **ArchivedResults**: results moved out of *Results* when a teacher changes a student's stage for that term
